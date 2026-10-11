// Scan of one page in an already running Chromium-based browser, shared by the Node build (local Edge) and
// the Workers build (Cloudflare Browser Run). Every request goes through one route handler that refuses
// private addresses and fetches without following redirects: redirects are followed hop by hop inside the
// handler, each target checked. WebSockets, service workers and downloads are refused. Only the main
// document is analysed (no iframes), and only an HTML one. No Node import here.
import type { AxeResults, Result, RunOptions } from "axe-core";
import type { Browser, BrowserContext, Page, Route } from "playwright-core";
import type { HostCheck } from "./address.ts";
import { BRAND } from "./brand.ts";
import type { Caller } from "./callers.ts";
import { MAX_NODES_PER_RULE, reduceResults, type ScanResults } from "./axe-results.ts";
import { WCAG22_AA_TAGS } from "./wcag.ts";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

export interface Axe {
  source: string;
  version: string;
  /**
   * Copy of the same file the browser loads by itself, checked against `integrity` (SRI); `source` is
   * injected only if it fails. For a remote browser: injecting 580 kB took 65 s on Browser Run (2026-10-04).
   */
  url?: string;
  integrity?: string;
}

export interface CoreOptions {
  checkHost: HostCheck;
  axe: Axe;
  /** Full user agent, from the browser version. */
  userAgent: (browserVersion: string) => string;
  /** Requests allowed per scan, subresources included. */
  maxRequests?: number;
  /** Largest response accepted, according to its Content-Length. */
  maxResponseBytes?: number;
  /**
   * `proxy` (default): every request is fetched by Playwright, redirects checked hop by hop.
   * `browser`: hosts are checked, then the browser fetches by itself; redirects are not intercepted.
   */
  network?: "proxy" | "browser";
  /**
   * In `proxy` mode, `continue` hands subresources to the browser once their host is checked; redirects they
   * follow escape the check. For a remote browser, where each proxied request is slow.
   */
  subresources?: "proxy" | "continue";
  /**
   * Fetches the main document hop by hop, without following redirects, instead of route.fetch: on
   * Browser Run, route.fetch returns redirects without any header (measured 2026-10-04).
   */
  fetchDocument?: (url: string, headers: Record<string, string>) => Promise<{ status: number; headers: HeaderList; body: FulfillBody }>;
  /** Until DOMContentLoaded. */
  navigationTimeoutMs?: number;
  /** Extra wait for the load event; past it, the page is scanned as it stands. */
  loadTimeoutMs?: number;
  axeTimeoutMs?: number;
  /** Filled in as the scan goes, for logs. */
  trace?: ScanTrace;
  /** Lets the scanner fetch any port, not only 80 and 443: for tests, whose server has a random port. */
  anyPort?: boolean;
}

/**
 * How far a scan got, updated as it goes: a caller that stops waiting at a deadline can still log it.
 * Durations and counts only, never an address.
 */
export interface ScanTrace {
  /** Duration in ms of each finished step: context, dom, load, idle, check, axeInject, axeRun, close. */
  steps: Record<string, number>;
  /** End of the last finished step (Date.now()). */
  lastStepAt: number;
  requests: number;
  blocked: number;
  /** Time spent fetching through the proxy, all requests added up. */
  fetchMs: number;
  /** Intercepted requests not answered yet. */
  pending: number;
  /** Documents committed in the main frame: more than one means a redirect or a navigation by the page. */
  navigations: number;
  /** How loading axe from its CDN went, when tried: loaded, error, timeout, navigated, exception. */
  axeCdn?: string;
}

export function newTrace(): ScanTrace {
  return { steps: {}, lastStepAt: Date.now(), requests: 0, blocked: 0, fetchMs: 0, pending: 0, navigations: 0 };
}

export interface ScanRequest {
  url: URL;
  bestPractices?: boolean;
  viewport?: { width: number; height: number };
  /** Scan again rather than reuse a recent result; a scanner with no reuse ignores it. */
  fresh?: boolean;
  /** Who asked, for the per-client limits of the public server; a scanner without limits ignores it. */
  caller?: Caller;
  /** Aborted when the client goes away: the public scanner then stops and gives its browser back. */
  signal?: AbortSignal;
}

export interface RawScan {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number | null;
  title: string;
  lang: string;
  scannedAt: string;
  axeVersion: string;
  viewport: { width: number; height: number };
  tags: string[];
  blockedRequests: number;
  results: ScanResults;
  /** Set when the result is reused from an earlier scan of the same page: until when (ISO date). */
  reusedUntil?: string;
  /** With `reusedUntil`: from when a request with `fresh` scans the page again (ISO date). */
  rescanFrom?: string;
}

/**
 * A reused result is replaced by a new scan on request (`fresh`) once it is this old: short enough to check a
 * fix, long enough that a model asking again and again does not start a browser each time.
 */
export const RESCAN_AFTER_MS = 5 * 60_000;

export class ScanError extends Error {}

// Bot protection pages served instead of the site (field test of 2026-10-04: 7 home pages out of 10).
// Scanning them would report the challenge's defects, or none, as the site's. The document type is read
// too: a PDF or an image the browser displays by itself is not a web page axe can check.
const VENDORS = ["DataDome", "Cloudflare", "HUMAN (PerimeterX)", "Imperva", "Akamai", "a bot protection service"];
const PAGE_CHECK = `(() => {
  const has = (selector) => document.querySelector(selector) !== null;
  const title = document.title.trim();
  const vendor = (() => {
    if (has('iframe[src*="captcha-delivery.com"]') || has('script[src*="captcha-delivery.com"]')) return "DataDome";
    if (has('[name="cf-turnstile-response"]') || has('script[src*="/cdn-cgi/challenge-platform/"]') || /^(Just a moment\\.\\.\\.|Attention Required! \\| Cloudflare)$/.test(title)) return "Cloudflare";
    if (has('#px-captcha') || has('script[src*="px-cloud.net"]')) return "HUMAN (PerimeterX)";
    if (has('script[src*="_Incapsula_Resource"]') || has('iframe[src*="_Incapsula_Resource"]')) return "Imperva";
    if (/errors\\.edgesuite\\.net/.test(document.body?.innerText ?? "")) return "Akamai";
    if (/^(Access Denied|Pardon Our Interruption)$/i.test(title)) return "a bot protection service";
    return "";
  })();
  return { vendor, type: String(document.contentType) };
})()`;

function blockedMessage(vendor: string, status: number | null): string {
  return `The site's bot protection (${vendor}${status ? `, HTTP ${status}` : ""}) refused the scanning browser and served a challenge page instead of the site. No result: scanning that page would describe the challenge, not the site. ${BLOCKED_ADVICE}`;
}

// Recourse for a blocked scan (audit A3-04), detailed on the documentation page.
const BLOCKED_ADVICE = `The site owner can let the scanner through with a bot protection rule for the user agent "${BRAND.slug}/", limited to the pages to check and removed afterwards, since anyone can send that user agent (${BRAND.site}/docs#blocked). Otherwise, test the page in a browser with a tool such as axe DevTools.`;

const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);

/** Media type of a Content-Type value, lower case, without its parameters; "" when absent. */
export function mediaType(value: string | null | undefined): string {
  return (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/** False only for a declared type that is not HTML: without a type, the browser decides. */
export function isHtmlType(value: string | null | undefined): boolean {
  const type = mediaType(value);
  return type === "" || HTML_TYPES.has(type);
}

function notHtmlMessage(type: string): string {
  const named = type.length <= 60 && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) ? `a ${type} document` : "a document that is not a web page";
  const advice = type === "application/pdf" ? " To check a PDF, use a PDF accessibility checker such as PAC (PDF Accessibility Checker) or the accessibility check of Adobe Acrobat Pro." : "";
  return `The address returns ${named}, not an HTML page: the scanner checks web pages only, so there is no result.${advice}`;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ScanError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

type BlockReason = "private_address" | "dns" | "scheme" | "redirects" | "port";

// Requests fetched by the scanner itself (fetch of the Worker, route.fetch) skip the browser's list of
// blocked ports: a page could aim them at a mail or database port (security review, 2026-10-04).
const STANDARD_PORTS = new Set(["", "80", "443"]);

const BLOCK_MESSAGES: Record<BlockReason, string> = {
  port: "The page or one of its redirects uses a non-standard port: only ports 80 and 443 are scanned.",
  private_address: "The page or one of its redirects points to a private or local address, which is not allowed.",
  dns: "The page redirects to a domain that cannot be resolved.",
  scheme: "The page redirects to a non-web address (only http and https are followed).",
  redirects: `The page redirects more than ${MAX_REDIRECTS} times, or in a loop.`,
};

// Longest answer read back from the axe run, in characters: 2 lists of 200 rules × 5 elements of about 3 000
// characters is 6 million; a real page stays far below (security review, 2026-10-05).
const MAX_RESULT_CHARS = 2_000_000;

/**
 * Runs `fn` (or the expression) in the page and reads back its answer as JSON, only if it is at most
 * `maxChars` long; undefined otherwise. The page's scripts can rewrite anything the evaluated code calls
 * (prototypes, `JSON`, `Promise`), so the answer is serialised in the page and its size checked there, as the
 * length of a string primitive, which no script can change: an unbounded answer would otherwise cross the
 * browser protocol into the Worker's 128 MB (security review, 2026-10-05). The string stays in an object
 * until then: a handle to a primitive carries its whole value across the protocol (second review, same day).
 */
async function evaluateBounded<A>(page: Page, fn: string | ((arg: A) => unknown), arg: A, maxChars: number): Promise<unknown> {
  const expression = typeof fn === "string" ? fn : `(${fn.toString()})(${JSON.stringify(arg) ?? "undefined"})`;
  // The bundler wraps named functions in `__name(...)`, which does not exist in the page: the same stand-in as
  // Playwright's own for a function it sends (normalizeEvaluationExpression).
  const handle = await page.evaluateHandle(`((__name) => (async () => ({ text: JSON.stringify(await (${expression})) }))())((t) => t)`);
  try {
    const text = await handle.evaluate((box: { text?: unknown }, max) => (typeof box.text === "string" && box.text.length <= max ? box.text : null), maxChars);
    if (typeof text !== "string") return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  } finally {
    void handle.dispose().catch(() => undefined);
  }
}

/**
 * Loads axe-core into the page: from `axe.url` when given and intact, from `axe.source` otherwise. Notes
 * in `trace.axeCdn` how the first way went, as a category without any address.
 */
async function injectAxe(page: Page, axe: Axe, timeoutMs: number, trace: ScanTrace): Promise<void> {
  const ready = async () => (await evaluateBounded(page, () => typeof (window as unknown as { axe?: { run?: unknown } }).axe?.run === "function", undefined, 8)) === true;
  if (axe.url && axe.integrity) {
    trace.axeCdn = await withTimeout(
      evaluateBounded(
        page,
        ({ url, integrity }) =>
          new Promise<"loaded" | "error">((resolve) => {
            const script = document.createElement("script");
            script.src = url;
            script.integrity = integrity;
            script.crossOrigin = "anonymous";
            // The CDN must not learn which page is scanned.
            script.referrerPolicy = "no-referrer";
            script.onload = () => resolve("loaded");
            script.onerror = () => resolve("error");
            (document.head ?? document.documentElement).appendChild(script);
          }),
        { url: axe.url, integrity: axe.integrity },
        16,
      ).then((answer) => (answer === "loaded" || answer === "error" ? answer : "exception")),
      10_000,
      "",
    ).catch((error: unknown) =>
      error instanceof ScanError ? "timeout" : /context was destroyed|navigat/i.test(error instanceof Error ? error.message : "") ? "navigated" : "exception",
    );
    if (trace.axeCdn === "loaded") {
      if (await ready().catch(() => false)) return;
      trace.axeCdn = "loaded without axe";
    }
  }
  // `;0` gives the script a fixed completion value: the page cannot make it send anything back.
  await withTimeout(page.evaluate(`${axe.source}\n;0`), timeoutMs, "The accessibility checker could not be loaded into the page in time.").catch(closedBrowser);
}

/** Rethrows a browser that went away during the analysis (session limit, crash) as a readable error. */
function closedBrowser(error: unknown): never {
  if (error instanceof Error && /has been closed|Target closed|disconnected/i.test(error.message)) {
    throw new ScanError("The scanning browser stopped during the analysis (session limit or crash). Try again in a minute; a very heavy page may not be scannable.");
  }
  throw error;
}

type Cookie = Parameters<BrowserContext["addCookies"]>[0][number];
type HeaderList = Array<{ name: string; value: string }>;
type FulfillBody = NonNullable<Parameters<Route["fulfill"]>[0]>["body"];

/** One response of the proxy, fetched by Playwright or by `fetchDocument`, not yet handed to the browser. */
interface Fetched {
  status: number;
  headers: HeaderList;
  fulfill(): Promise<void>;
}

function header(response: Fetched, name: string): string | undefined {
  return response.headers.find((entry) => entry.name.toLowerCase() === name)?.value;
}

/** Set-Cookie values of a response, one per cookie: some runtimes join them with commas or newlines. */
function setCookieHeaders(headers: HeaderList): string[] {
  return headers
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .flatMap((header) => header.value.split(/\n|,(?=\s*[^;,=\s]+=)/))
    .map((value) => value.trim())
    .filter(Boolean);
}

/** Cookie of one Set-Cookie header received from `url`; path defaults to "/", a simplification for one scan. */
export function parseSetCookie(header: string, url: URL): Cookie | undefined {
  const [pair = "", ...attributes] = header.split(";");
  const equals = pair.indexOf("=");
  if (equals <= 0) return undefined;
  const cookie: Cookie = { name: pair.slice(0, equals).trim(), value: pair.slice(equals + 1).trim(), domain: url.hostname, path: "/" };
  for (const attribute of attributes) {
    const [key = "", ...rest] = attribute.split("=");
    const name = key.trim().toLowerCase();
    const value = rest.join("=").trim();
    if (name === "domain" && value) {
      const domain = value.replace(/^\./, "").toLowerCase();
      if (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) return undefined;
      cookie.domain = `.${domain}`;
    } else if (name === "path" && value.startsWith("/")) {
      cookie.path = value;
    } else if (name === "secure") {
      cookie.secure = true;
    }
  }
  return cookie;
}

interface Counters {
  trace: ScanTrace;
  /** Final address of a main-document redirect chain, already checked hop by hop. */
  redirectTo?: string;
  /** Why the main document was refused, for the error message. */
  mainBlock?: BlockReason;
  /** Why fetching the main document failed, when it can be told to the user. */
  mainError?: ScanError;
}

/** Refuses a private or unknown target before any browser is involved. */
export async function precheck(url: URL, checkHost: HostCheck, anyPort = false): Promise<void> {
  // Before any browser: on Browser Run, a refused navigation only fails at the navigation timeout.
  if (!anyPort && !STANDARD_PORTS.has(url.port)) throw new ScanError(BLOCK_MESSAGES.port);
  const verdict = await checkHost(url.hostname);
  if (verdict === "private_address") throw new ScanError("This address is private or local: only public web pages can be scanned.");
  if (verdict === "dns") throw new ScanError(`Domain not found: ${url.hostname}.`);
}

async function prepareContext(instance: Browser, options: CoreOptions, viewport: { width: number; height: number }, counters: Counters): Promise<BrowserContext> {
  const maxRequests = options.maxRequests ?? 400;
  const maxResponseBytes = options.maxResponseBytes ?? 15_000_000;
  const context = await instance.newContext({
    viewport,
    bypassCSP: true,
    serviceWorkers: "block",
    acceptDownloads: false,
    javaScriptEnabled: true,
    locale: "en-US",
    userAgent: options.userAgent(instance.version()),
  });
  await context.routeWebSocket(/.*/, (ws) => ws.close());
  await context.route("**/*", async (route) => {
    const request = route.request();
    const isMainDocument = request.isNavigationRequest() && request.frame().parentFrame() === null;
    const refuse = async (reason: BlockReason | "cap") => {
      counters.trace.blocked += 1;
      if (isMainDocument && reason !== "cap") counters.mainBlock ??= reason;
      await route.abort("blockedbyclient");
    };
    let target: URL;
    try {
      target = new URL(request.url());
    } catch {
      await route.abort("blockedbyclient");
      return;
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      await refuse("scheme");
      return;
    }
    counters.trace.requests += 1;
    if (counters.trace.requests > maxRequests) {
      await refuse("cap");
      return;
    }
    counters.trace.pending += 1;
    try {
      await handle(route, target, isMainDocument, refuse);
    } finally {
      counters.trace.pending -= 1;
    }
  });
  return context;

  async function handle(route: Route, target: URL, isMainDocument: boolean, refuse: (reason: BlockReason | "cap") => Promise<void>): Promise<void> {
    const request = route.request();
    const verdict = await options.checkHost(target.hostname);
    if (verdict) {
      await refuse(verdict);
      return;
    }
    if (options.network === "browser" || (!isMainDocument && options.subresources === "continue")) {
      // The browser fetches with its own network stack; redirects it follows escape this handler.
      await route.continue().catch(() => undefined);
      return;
    }
    if (!options.anyPort && !STANDARD_PORTS.has(target.port)) {
      await refuse("port");
      return;
    }
    const viaDocumentFetch = isMainDocument ? options.fetchDocument : undefined;
    const send = async (url: URL, cookie: string | undefined): Promise<Fetched> => {
      const headers = cookie ? { ...request.headers(), cookie } : undefined;
      if (viaDocumentFetch) {
        const fetched = await viaDocumentFetch(url.href, headers ?? request.headers());
        const merged: Record<string, string> = {};
        for (const { name, value } of fetched.headers) {
          const key = name.toLowerCase();
          merged[key] = key in merged ? `${merged[key]}\n${value}` : value;
        }
        return { status: fetched.status, headers: fetched.headers, fulfill: () => route.fulfill({ status: fetched.status, headers: merged, body: fetched.body }) };
      }
      const response = await route.fetch({ url: url.href, ...(headers ? { headers } : {}), maxRedirects: 0, timeout: 20_000 });
      return { status: response.status(), headers: response.headersArray(), fulfill: () => route.fulfill({ response }) };
    };
    const fetchStarted = Date.now();
    try {
      // Redirects are followed here, hop by hop, each target checked: a redirect handed back to the
      // browser would be followed without passing through this handler again (measured 2026-10-03).
      let current = target;
      let response = await send(target, undefined);
      for (let hop = 0; REDIRECT_STATUSES.has(response.status); hop += 1) {
        const location = header(response, "location");
        let next: URL | undefined;
        try {
          next = location ? new URL(location, current) : undefined;
        } catch {
          next = undefined;
        }
        if (!next || hop >= MAX_REDIRECTS) {
          await refuse("redirects");
          return;
        }
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          await refuse("scheme");
          return;
        }
        if (!options.anyPort && !STANDARD_PORTS.has(next.port)) {
          await refuse("port");
          return;
        }
        const hopVerdict = await options.checkHost(next.hostname);
        if (hopVerdict) {
          await refuse(hopVerdict);
          return;
        }
        // Cookies set by a hop go to the next one and to the browser, or a site that checks cookie support
        // with a redirect loops (service-public.fr on Browser Run, 2026-10-04).
        const received = setCookieHeaders(response.headers).flatMap((value) => parseSetCookie(value, current) ?? []);
        if (received.length) await context.addCookies(received).catch(() => undefined);
        current = next;
        const jar = await context.cookies(next.href).catch(() => []);
        response = await send(next, jar.length ? jar.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") : undefined);
      }
      // The main document must carry its final URL, or its relative links would resolve against the first
      // one: abort, and the scan navigates again to the checked final address.
      if (current.href !== target.href && isMainDocument) {
        counters.redirectTo = current.href;
        await route.abort("aborted");
        return;
      }
      const length = Number(header(response, "content-length") ?? 0);
      if (length > maxResponseBytes) {
        if (isMainDocument) counters.mainError ??= new ScanError(`The page is larger than ${maxResponseBytes / 1_000_000} MB, too large to scan.`);
        await refuse("cap");
        return;
      }
      // A PDF or an image would be displayed by the browser's own viewer and its controls scanned instead
      // (PDF scanned in production on 2026-10-05: "passed" report). An error page keeps its HTTP status message.
      const type = header(response, "content-type");
      if (isMainDocument && response.status < 400 && !isHtmlType(type)) {
        counters.mainError ??= new ScanError(notHtmlMessage(mediaType(type)));
        await route.abort("aborted");
        return;
      }
      await response.fulfill();
    } catch (error) {
      if (isMainDocument && error instanceof ScanError) counters.mainError ??= error;
      else if (isMainDocument && /timeout|timed out/i.test(error instanceof Error ? `${error.name} ${error.message}` : "")) {
        counters.mainError ??= new ScanError("The site did not answer within 20 s. Check the address, or try again later.");
      }
      await route.abort("failed").catch(() => undefined);
    } finally {
      counters.trace.fetchMs += Date.now() - fetchStarted;
    }
  }
}

/** Scans one page in `instance`; the caller owns the browser and closes it. */
export async function scanInBrowser(instance: Browser, request: ScanRequest, options: CoreOptions): Promise<RawScan> {
  const navigationTimeoutMs = options.navigationTimeoutMs ?? 30_000;
  const loadTimeoutMs = options.loadTimeoutMs ?? 15_000;
  const axeTimeoutMs = options.axeTimeoutMs ?? 45_000;
  const viewport = request.viewport ?? { width: 1280, height: 800 };
  const trace = options.trace ?? newTrace();
  const counters: Counters = { trace };
  trace.lastStepAt = Date.now();
  const step = (name: string) => {
    const now = Date.now();
    trace.steps[name] = now - trace.lastStepAt;
    trace.lastStepAt = now;
  };
  const context = await prepareContext(instance, options, viewport, counters);
  step("context");
  try {
    const page = await context.newPage();
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) trace.navigations += 1;
    });
    let response;
    let address = request.url.href;
    for (let attempt = 0; ; attempt += 1) {
      try {
        response = await page.goto(address, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
        break;
      } catch (error) {
        const redirected = counters.redirectTo;
        counters.redirectTo = undefined;
        if (redirected && attempt < 2) {
          address = redirected;
          continue;
        }
        const message = (error as Error).message.split("\n")[0] ?? "";
        // The recorded causes first: on Browser Run, an aborted main document can surface as another
        // network error than ERR_BLOCKED_BY_CLIENT (ERR_TIMED_OUT for a refused port, 2026-10-04), and a
        // document refused for its size or its type is not a private address.
        if (counters.mainBlock) throw new ScanError(BLOCK_MESSAGES[counters.mainBlock]);
        if (counters.mainError) throw counters.mainError;
        if (/ERR_BLOCKED_BY_CLIENT/.test(message)) throw new ScanError(BLOCK_MESSAGES.private_address);
        if (/Timeout/i.test(message)) throw new ScanError(`The page did not finish loading within ${navigationTimeoutMs / 1000} s.`);
        throw new ScanError(`The page could not be loaded (${message.replace(/^page\.goto: /, "")}).`);
      }
    }
    step("dom");
    // Images and late scripts get a bounded wait: a page of several hundred requests (IKEA on Browser Run,
    // 2026-10-04) would otherwise fail as a whole instead of being scanned as it stands.
    await page.waitForLoadState("load", { timeout: loadTimeoutMs }).catch(() => undefined);
    step("load");
    // Leave late scripts a moment to render, without waiting forever on pages that never go idle.
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
    step("idle");

    const status = response?.status() ?? null;
    const check = ((await withTimeout(evaluateBounded(page, PAGE_CHECK, undefined, 1_000), 10_000, "").catch((error: unknown) => {
      if (error instanceof ScanError) throw new ScanError("The page did not answer the scanner within 10 s: its scripts keep it busy, or it keeps navigating.");
      return {};
    })) ?? {}) as { vendor?: unknown; type?: unknown };
    step("check");
    // Read in the page, whose scripts can rewrite what it returns: only known values are used.
    const vendor = VENDORS.find((name) => name === check.vendor);
    if (vendor) throw new ScanError(blockedMessage(vendor, status));
    if (status !== null && status >= 400) {
      throw new ScanError(
        status === 401 || status === 403 || status === 429
          ? `The site refused the scanning browser (HTTP ${status}), probably through bot protection or a login wall. No result: the page received is an error page, not the site. ${BLOCKED_ADVICE}`
          : status >= 500
            ? `The site answered HTTP ${status}, an error on the site's side. No result: the page received is an error page. Try again later.`
            : `The page answered HTTP ${status}${status === 404 ? " (not found)" : ""}. No result: check the address.`,
      );
    }
    // In `browser` mode, or when the server declared no type, the browser chose how to display the document.
    if (typeof check.type === "string" && !isHtmlType(check.type)) throw new ScanError(notHtmlMessage(mediaType(check.type)));

    const tags = request.bestPractices ? [...WCAG22_AA_TAGS, "best-practice"] : [...WCAG22_AA_TAGS];
    const runOptions: RunOptions = { runOnly: { type: "tag", values: tags }, resultTypes: ["violations", "incomplete"], iframes: false, elementRef: false };
    await injectAxe(page, options.axe, axeTimeoutMs, trace);
    step("axeInject");
    // Reduced in the page first, so that a page with thousands of failing elements does not send them all
    // through the browser protocol; checked and bounded again by reduceResults, since the page can rewrite it.
    const results = await withTimeout(
      evaluateBounded(
        page,
        async ({ opts, maxRules, maxNodes }: { opts: RunOptions; maxRules: number; maxNodes: number }) => {
          const axe = (window as unknown as { axe: { run(context: Document, options: unknown): Promise<AxeResults> } }).axe;
          const out = await axe.run(document, opts);
          const cut = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
          const reduce = (rules: Result[]) =>
            rules.slice(0, maxRules).map((rule) => {
              const elementsByImpact: Record<string, number> = {};
              for (const node of rule.nodes) {
                const impact = node.impact ?? rule.impact ?? "minor";
                elementsByImpact[impact] = (elementsByImpact[impact] ?? 0) + 1;
              }
              return {
                id: rule.id,
                impact: rule.impact ?? null,
                elements: rule.nodes.length,
                elementsByImpact,
                nodes: rule.nodes.slice(0, maxNodes).map((node) => ({ target: node.target, html: cut(node.html, 1000), failureSummary: cut(node.failureSummary, 2000), impact: node.impact ?? null })),
              };
            });
          return { violations: reduce(out.violations), incomplete: reduce(out.incomplete), passes: out.passes.slice(0, maxRules).map((rule) => rule.id) };
        },
        { opts: runOptions, maxRules: 200, maxNodes: MAX_NODES_PER_RULE },
        MAX_RESULT_CHARS,
      ),
      axeTimeoutMs,
      "The accessibility analysis took too long on this page.",
    ).catch(closedBrowser);
    if (results === undefined) {
      throw new ScanError("The page sent back an analysis result that is too large or unreadable, which happens when its scripts rewrite the browser's built-in functions. No result.");
    }
    step("axeRun");
    const meta = ((await evaluateBounded(page, () => ({ title: document.title.slice(0, 1000), lang: (document.documentElement.getAttribute("lang") ?? "").slice(0, 100) }), undefined, 4_000).catch(() => ({}))) ??
      {}) as { title?: unknown; lang?: unknown };
    return {
      requestedUrl: request.url.href,
      finalUrl: page.url(),
      httpStatus: response?.status() ?? null,
      title: typeof meta.title === "string" ? meta.title.slice(0, 1000) : "",
      lang: typeof meta.lang === "string" ? meta.lang.slice(0, 100) : "",
      scannedAt: new Date().toISOString(),
      axeVersion: options.axe.version,
      viewport,
      tags,
      blockedRequests: trace.blocked,
      results: reduceResults(results),
    };
  } finally {
    // Bounded: close() waits for the requests still held by the route handler (IKEA on Browser Run,
    // 2026-10-04: 60 s after a failed load).
    await withTimeout(context.close(), 5_000, "").catch(() => undefined);
    step("close");
  }
}

export interface Scanner {
  scan(request: ScanRequest): Promise<RawScan>;
  close(): Promise<void>;
}
