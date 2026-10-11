// Scanner of the Workers build: one Cloudflare Browser Run session per scan, closed afterwards. The host
// check goes through DNS over HTTPS and is memoised for the scan. The main document and each of its
// redirects are checked and fetched by this Worker; subresources are checked by host, then fetched by the
// remote browser itself, so their own redirects are not checked.
import { Buffer } from "node:buffer";
import { launch, type BrowserWorker } from "@cloudflare/playwright";
import type { Browser } from "playwright-core";
import type { HostCheck } from "../address.ts";
import { BRAND } from "../brand.ts";
import { memoHostCheck } from "../dns-doh.ts";
import { isHtmlType, newTrace, precheck, scanInBrowser, ScanError, withTimeout, type Axe, type RawScan, type Scanner, type ScanRequest } from "../scan-core.ts";
import { scanResultOf, type ScanResult } from "./metrics.ts";
import type { ScanCache } from "./scan-cache.ts";

// The Worker's fetch hands back the body already decoded: these headers would describe the encoded one.
const DROPPED_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding"]);

// Enforced while reading: the body is held in the Worker's memory, 128 MB shared by the requests of an isolate.
const MAX_DOCUMENT_BYTES = 5_000_000;

async function readCapped(body: ReadableStream<Uint8Array> | null): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (body) {
    const reader = body.getReader();
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      size += read.value.byteLength;
      if (size > MAX_DOCUMENT_BYTES) {
        await reader.cancel();
        throw new ScanError(`The page is larger than ${MAX_DOCUMENT_BYTES / 1_000_000} MB, too large to scan.`);
      }
      chunks.push(read.value);
    }
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

/** Main document hop with the Worker's own fetch, which keeps Location and every Set-Cookie of a redirect. */
async function fetchDocument(url: string, headers: Record<string, string>) {
  const response = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  const list: Array<{ name: string; value: string }> = [];
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie" && !DROPPED_HEADERS.has(name)) list.push({ name, value });
  });
  for (const value of response.headers.getSetCookie()) list.push({ name: "set-cookie", value });
  // scan-core refuses a document that is not HTML on its headers alone: its body is not downloaded.
  if (response.status < 400 && !isHtmlType(response.headers.get("content-type"))) {
    await response.body?.cancel();
    return { status: response.status, headers: list, body: Buffer.alloc(0) };
  }
  return { status: response.status, headers: list, body: Buffer.from(await readCapped(response.body)) };
}

/**
 * Whole scan, browser launch excluded: past it the user gets an error rather than a hanging tool call.
 * Measured in production on 2026-10-04: 4 to 14 s (IKEA, 397 requests); a heavier page costs more than
 * its result is worth (QCM of 2026-10-04).
 */
const SCAN_DEADLINE_MS = 30_000;
const LAUNCH_DEADLINE_MS = 30_000;
const CLOSE_DEADLINE_MS = 5_000;
/** Browser Run closes an idle browser after one minute: what a browser that fails to close is billed. */
const BROWSER_IDLE_MS = 60_000;

async function subresourceIntegrity(source: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-384", new TextEncoder().encode(source)));
  return `sha384-${btoa(String.fromCharCode(...digest))}`;
}

/** Longest a scan can hold its slot: launch, scan and close deadlines, plus a margin. */
export const SCAN_SLOT_TTL_MS = LAUNCH_DEADLINE_MS + SCAN_DEADLINE_MS + CLOSE_DEADLINE_MS + 25_000;

/** Longest browser time one scan can be billed: launch, scan, then a browser that fails to close. */
export const SCAN_BILLED_MAX_MS = LAUNCH_DEADLINE_MS + SCAN_DEADLINE_MS + CLOSE_DEADLINE_MS + BROWSER_IDLE_MS;

export interface CloudflareScannerOptions {
  checkHost: HostCheck;
  axe: Axe;
  /** Called first, cached results included: throws a ScanError to refuse a client calling too often. */
  gate?: (request: ScanRequest) => Promise<void>;
  /**
   * Called once the address passed its check, before any browser starts: throws a ScanError to refuse
   * (limits), or returns the function that gives the slot back with the browser time billed.
   */
  admit: (request: ScanRequest) => Promise<(billedMs: number) => Promise<void>>;
  /** Results reused for the same request; a hit starts no browser and uses no budget. */
  cache?: ScanCache;
  /**
   * The current request: work handed to its `waitUntil` goes on after the client has gone, when the runtime
   * drops everything else, `finally` blocks included; its signal aborts when the client leaves (audit A1-04).
   */
  scope?: () => { waitUntil(work: Promise<unknown>): void; signal: AbortSignal; report?: (result: ScanResult, ms: number) => void } | undefined;
}

/** How the browser of one scan ended, and how to end it early when the client leaves. */
interface Usage {
  closeTimedOut: boolean;
  closeBrowser?: () => Promise<void>;
  /** Aborted when the client leaves. */
  signal?: AbortSignal;
}

export function createCloudflareScanner(binding: BrowserWorker, options: CloudflareScannerOptions): Scanner {
  const userAgent = (version: string) =>
    `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36 ${BRAND.slug}/${BRAND.version} (accessibility check requested by a user)`;
  // `axe.url` serves the bundled file itself (this Worker, audit A1-11): the hash is computed on it.
  let axe: Promise<Axe> | undefined;
  return {
    async scan(request) {
      const scope = options.scope?.();
      // How this scan ended and how long it took, for the usage count (metrics.ts): a result, never the address.
      const counted = Date.now();
      const report = (result: ScanResult) => {
        try {
          scope?.report?.(result, Date.now() - counted);
        } catch {
          // Counting is never worth a failed scan.
        }
      };
      let checkHost: HostCheck;
      try {
        axe ??= options.axe.url ? subresourceIntegrity(options.axe.source).then((integrity) => ({ ...options.axe, integrity })) : Promise.resolve(options.axe);
        await options.gate?.(request);
        const cached = await options.cache?.get(request);
        if (cached) {
          report("cache");
          return cached;
        }
        checkHost = memoHostCheck(options.checkHost);
        // A refused address costs neither a browser nor any of the daily budget.
        await precheck(request.url, checkHost);
      } catch (error) {
        report(scanResultOf(error));
        throw error;
      }
      const signals = [request.signal, scope?.signal].filter((signal): signal is AbortSignal => signal !== undefined);
      const signal = signals.length > 0 ? AbortSignal.any(signals) : undefined;
      // Handed to `waitUntil`, admission included: once the client has gone, the runtime would drop it, and with
      // it the slot's release, which then stayed held until its 90 s expiry (wrangler dev, 2026-10-05).
      // `waitUntil` itself ends 30 s after the client leaves: a scan longer than that still falls back on the
      // slot's expiry.
      const running = (async () => {
        const giveBack = await options.admit(request);
        const started = Date.now();
        const usage: Usage = { closeTimedOut: false, ...(signal ? { signal } : {}) };
        // If the runtime reports the client leaving, the browser closes at once and the scan fails early; not
        // observed in wrangler dev, where the scan runs to its end under `waitUntil` (2026-10-05).
        const onAbort = () => void usage.closeBrowser?.();
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          if (signal?.aborted) throw new ScanError("The request was cancelled.");
          const raw = await scanAdmitted(request, checkHost, await axe, usage);
          await options.cache?.put(request, raw);
          return raw;
        } finally {
          signal?.removeEventListener("abort", onAbort);
          await giveBack(Date.now() - started + (usage.closeTimedOut ? BROWSER_IDLE_MS : 0)).catch(() => undefined);
        }
      })();
      // Reported before the tool call gets its answer: the handlers run in the order they were added.
      const reported = running.then(() => report("ok"), (error: unknown) => report(scanResultOf(error)));
      scope?.waitUntil(reported);
      return running;
    },
    async close() {},
  };

  async function scanAdmitted(request: ScanRequest, checkHost: HostCheck, axe: Axe, usage: Usage): Promise<RawScan> {
    const started = Date.now();
    const launching = launch(binding);
    const browser = await withTimeout(launching, LAUNCH_DEADLINE_MS, "launch timed out").catch((error: Error) => {
      // A browser that starts after the deadline is closed at once instead of being billed until its
      // keep-alive ends.
      launching.then((late) => late.close()).catch(() => undefined);
      throw new ScanError(`The scanning browser is not available right now (${error.message.split("\n")[0]}). Try again in a minute.`);
    });
    const launchMs = Date.now() - started;
    // Bounded: once the remote session is lost, close() never settles and would hold the tool call open
    // past the scan deadline (IKEA, 2026-10-04: "Network connection lost", call still open after 10 min).
    let closing: Promise<void> | undefined;
    usage.closeBrowser = () =>
      (closing ??= withTimeout(browser.close(), CLOSE_DEADLINE_MS, "close timed out").then(
        () => undefined,
        () => {
          usage.closeTimedOut = true;
        },
      ));
    // The client left while the browser was starting.
    if (usage.signal?.aborted) {
      await usage.closeBrowser();
      throw new ScanError("The request was cancelled.");
    }
    const trace = newTrace();
    let outcome = "ok";
    try {
      // Same Playwright API, distinct type declarations: the Cloudflare fork follows upstream 1.58.
      // Subresources go straight from the remote browser: proxied through this Worker they took about
      // 30 s each on a page of 200 requests (IKEA, 2026-10-04).
      return await withTimeout(
        scanInBrowser(browser as unknown as Browser, request, { checkHost, axe, userAgent, trace, fetchDocument, subresources: "continue" }),
        SCAN_DEADLINE_MS,
        `The scan did not finish within ${SCAN_DEADLINE_MS / 1000} s; this page is too heavy for the scanner. Try a lighter page of the site.`,
      );
    } catch (error) {
      // scanInBrowser always ends with its "close" step, unless the deadline cut it.
      outcome = trace.steps.close === undefined ? "timeout" : error instanceof ScanError ? "refused" : "error";
      throw error;
    } finally {
      // Durations and counts only, never the scanned address. On a timeout, `stalledMs` is the time spent
      // in the step after the last one logged.
      const { steps, lastStepAt, ...counts } = trace;
      console.log(`[scan] ${JSON.stringify({ outcome, launch: launchMs, ...steps, ...counts, ...(outcome === "timeout" ? { stalledMs: Date.now() - lastStepAt } : {}) })}`);
      await usage.closeBrowser();
    }
  }
}
