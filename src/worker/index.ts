// Workers entry: public MCP endpoint (Streamable HTTP, stateless, no authentication) on `/mcp`, plus the
// site pages (home, documentation, privacy, terms, not found) with their fonts and favicon, and the OpenAI domain challenge. The log line carries the MCP
// method and tool name only, never the arguments (scanned URLs, figures) nor the results. A usage count of the
// same kind (method, tool, platform, status, scan result, durations) goes to Analytics Engine (metrics.ts).
import type { BrowserWorker } from "@cloudflare/playwright";
// Bundled as text by the wrangler rule on `axe.min.js`.
import axeSource from "axe-core/axe.min.js";
import axePackage from "axe-core/package.json";
import rgaaData from "../../data/rgaa-4.1.2-wcag.json";
// Site fonts, favicon and icon, bundled by the wrangler rules on `*.woff2`, `*.svg` and `*.png`.
import fontData from "../../assets/fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2";
import monoFontData from "../../assets/fonts/atkinson-hyperlegible-mono-latin-wght-normal.woff2";
import faviconSvg from "../../assets/euroa11y-logo.svg";
import iconPng from "../../assets/euroa11y-logo-512.png";
// OpenAI's list of ChatGPT connector addresses as published on 2026-09-22, until the Worker loads it again.
import connectorSnapshot from "../../data/chatgpt-connectors.json";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { BRAND } from "../brand.ts";
import { callerOf, createRangeList, type Caller } from "../callers.ts";
import { createDohHostCheck } from "../dns-doh.ts";
import { createHttpEntry, jsonRpcError, type HttpEntry } from "../mcp/http.ts";
import { createMcpServer } from "../mcp/server.ts";
import { docsPage, FAVICON_PATH, FONT_PATH, homePage, ICON_PATH, MONO_FONT_PATH, notFoundPage, privacyPage, termsPage } from "../pages.ts";
import { buildRgaaIndex, type RgaaData } from "../rgaa-index.ts";
import type { ScanRequest } from "../scan-core.ts";
import type { Admission, BudgetLimits } from "./budget.ts";
import { httpsRedirect, withHsts } from "./https.ts";
import { abortOnCancel, createTracker, isEventStream, LimitError, mcpLabels, type CallLabels, type MetricsSink, type ScanResult, type Tracker } from "./metrics.ts";
import { DailyQuota } from "./quota.ts";
import { createScanCache, type CacheStore } from "./scan-cache.ts";
import { seoFile } from "./seo.ts";
import { createCloudflareScanner, SCAN_BILLED_MAX_MS, SCAN_SLOT_TTL_MS } from "./scanner-cf.ts";

export { DailyQuota };

interface Env {
  BROWSER: BrowserWorker;
  QUOTA: DurableObjectNamespace<DailyQuota>;
  /** Usage count (Workers Analytics Engine, dataset `euroa11y_usage`); absent in tests and local runs: nothing is counted. */
  METRICS?: MetricsSink;
  /** Scan calls per client and minute (`ratelimits` in wrangler.jsonc). */
  SCAN_RATE?: RateLimit;
  /** Scan calls per minute from one platform server address, for callers that name no user. */
  SCAN_RATE_SHARED?: RateLimit;
  /** Browser time allowed per UTC day, in seconds, all users together. */
  DAILY_BROWSER_SECONDS: string;
  POLICY_DATE: string;
  /** Token given by OpenAI for the domain check, served on /.well-known/openai-apps-challenge. */
  OPENAI_APPS_CHALLENGE?: string;
}

const MCP_PATH = "/mcp";
// axe-core for the scanned pages, served from here rather than a CDN that would see each scanned site
// (audit A1-11); the path carries the version.
const AXE_PATH = `/axe/${axePackage.version}/axe.min.js`;
const MAX_BODY_BYTES = 256_000;
// Server-side MCP clients send no Origin; a browser page may only call from these sites.
const ALLOWED_ORIGINS = ["chatgpt.com", "chat.openai.com", "claude.ai", "claude.com"];

// The current request, for the scanner shared by all requests of a host (audit A1-04): its `waitUntil`, and a
// signal raised when the client drops the response. A tool call answers in a stream that is already sent
// when the client leaves, so `request.signal` never fires then (wrangler dev, 2026-10-05): the runtime
// drops the work left outside `waitUntil`. Neither signal was seen firing in wrangler dev; `waitUntil` alone
// is what frees the slot (checked 2026-10-05).
interface RequestScope {
  waitUntil(work: Promise<unknown>): void;
  signal: AbortSignal;
  /** How the request's scan ended, for the usage count (metrics.ts). */
  report?: (result: ScanResult, ms: number) => void;
}
const requestScope = new AsyncLocalStorage<RequestScope>();

const rgaa = buildRgaaIndex(rgaaData as RgaaData);
const checkHost = createDohHostCheck();
const entries = new Map<string, HttpEntry>();

// Scans running at once, all users together: Browser Run includes 10 simultaneous browsers and bills the
// ones beyond (security review, 2026-10-04); the other 2 serve `wrangler dev` in remote mode, on the same
// account (audit A1-01).
const MAX_RUNNING_SCANS = 8;
// Per-client limits (QCM of 2026-10-05). Each platform keeps browsers and a share of the daily budget that the
// others cannot take, the rest is shared; a client runs one scan at a time, up to 40 a day; a site gets two
// scans at a time and 30 an hour; a client sends at most 10 scan calls a minute (SCAN_RATE). A platform server
// address that names no user (Claude on the web, ChatGPT without `openai/subject`) sends at most 30 a minute
// (SCAN_RATE_SHARED), since many users share it (QCM of 2026-10-05).
const PLATFORM_RESERVES = { chatgpt: { running: 2, share: 0.3 }, claude: { running: 2, share: 0.3 }, direct: { running: 1, share: 0.1 } };
const CLIENT_DAILY_SCANS = 40;
const SITE_RUNNING_SCANS = 2;
const SITE_HOURLY_SCANS = 30;
// A page scanned again with the same options within this time gets the earlier result (QCM of 2026-10-04).
const SCAN_CACHE_SECONDS = 24 * 3600;

const CONNECTORS_URL = "https://openai.com/chatgpt-connectors.json";
const openaiRanges = createRangeList(connectorSnapshot, loadConnectorList, { log: (line) => console.log(`[ranges] ${line}`) });

/** OpenAI's current list, which it asks to fetch regularly (developers.openai.com/api/docs/guides/ip-addresses). */
async function loadConnectorList(): Promise<unknown> {
  const response = await fetch(CONNECTORS_URL, { signal: AbortSignal.timeout(5_000) });
  const body = response.ok ? await readCappedBody(response) : null;
  if (!body) throw new Error(`HTTP ${response.status}${response.ok ? ", too large" : ""}`);
  return JSON.parse(new TextDecoder().decode(body));
}

// Without the request's caller (never the case behind the Worker's own entry), the strictest class.
const UNKNOWN_CALLER: Caller = { platform: "direct", id: "unknown" };

function scanLimits(env: Env): BudgetLimits {
  return {
    dailyBudgetMs: (Number(env.DAILY_BROWSER_SECONDS) || 3600) * 1000,
    maxRunning: MAX_RUNNING_SCANS,
    reserveMs: SCAN_BILLED_MAX_MS,
    slotTtlMs: SCAN_SLOT_TTL_MS,
    reserves: PLATFORM_RESERVES,
    clientRunning: 1,
    clientDaily: CLIENT_DAILY_SCANS,
    siteRunning: SITE_RUNNING_SCANS,
    siteHourly: SITE_HOURLY_SCANS,
  };
}

function refusalMessage(admission: Exclude<Admission, { status: "admitted" }>): string {
  switch (admission.status) {
    case "client_busy":
      return "A scan you started is still running. Wait for its result, then try again.";
    case "client_daily":
      return `The ${CLIENT_DAILY_SCANS} free scans of the day for this ChatGPT account or network address are used up. Try again after midnight UTC.`;
    case "site_busy":
      return `${SITE_RUNNING_SCANS} scans of this site are already running. Try again in a minute.`;
    case "site_hourly":
      return `This site had ${SITE_HOURLY_SCANS} scans in the last hour, the most allowed. Try again after ${new Date(admission.retryAt ?? Date.now() + 3600_000).toISOString().slice(11, 16)} UTC.`;
    case "busy":
      return "Too many scans are running right now. Try again in a minute.";
    case "budget":
      return "Today's free scanning capacity is used up. Try again after midnight UTC.";
  }
}

/** Admission by the limits of the DailyQuota Durable Object, one for the whole service. */
function admitter(env: Env): (request: ScanRequest) => Promise<(billedMs: number) => Promise<void>> {
  return async ({ url, caller = UNKNOWN_CALLER }) => {
    const quota = env.QUOTA.get(env.QUOTA.idFromName("global"));
    const site = url.hostname.replace(/^www\./, "");
    const admission = await quota.admit(scanLimits(env), { platform: caller.platform, site, ...(caller.id === undefined ? {} : { client: caller.id }) });
    if (admission.status !== "admitted") {
      // The limit and the kind of client only, never the identifier or the page.
      console.log(`[limit] ${admission.status} ${caller.platform}`);
      throw new LimitError(refusalMessage(admission));
    }
    const slot = admission.slot;
    return (billedMs) => quota.release(slot, billedMs);
  };
}

/**
 * Scan calls per minute, cached results included: per client, or per platform server address for a platform
 * that names no user.
 */
function gate(env: Env): (request: ScanRequest) => Promise<void> {
  return async ({ caller }) => {
    const shared = caller?.id === undefined;
    const limiter = shared ? env.SCAN_RATE_SHARED : env.SCAN_RATE;
    const key = caller?.id ?? caller?.address;
    if (!limiter || key === undefined) return;
    let allowed = true;
    try {
      ({ success: allowed } = await limiter.limit({ key: createHash("sha256").update(key).digest("hex") }));
    } catch {
      // A safeguard only: if the rate limiter fails, the Durable Object's limits still apply.
    }
    if (!allowed) {
      console.log(`[limit] rate${shared ? "-shared" : ""} ${caller?.platform}`);
      throw new LimitError(
        shared
          ? "Too many scan requests in the last minute through this platform's server, which many users share. Try again in a minute."
          : "Too many scan requests in the last minute from this ChatGPT account or network address. Try again in a minute.",
      );
    }
  };
}

/** One entry per public host name: Cloudflare only routes the configured hosts to this Worker. */
function entryFor(host: string, env: Env): HttpEntry {
  let entry = entries.get(host);
  if (!entry) {
    if (entries.size > 8) entries.clear();
    // `caches.default` is Workers-only; the DOM library, needed by scan-core, hides it from the type.
    const cache = createScanCache((caches as unknown as { default: CacheStore }).default, `https://${host}`, SCAN_CACHE_SECONDS);
    const scanner = createCloudflareScanner(env.BROWSER, {
      checkHost,
      axe: { source: axeSource, version: axePackage.version, url: `https://${host}${AXE_PATH}` },
      gate: gate(env),
      admit: admitter(env),
      cache,
      scope: () => requestScope.getStore(),
    });
    entry = createHttpEntry({
      mcpPath: MCP_PATH,
      allowedHosts: new Set([host]),
      allowedOrigins: new Set(ALLOWED_ORIGINS),
      maxBodyBytes: MAX_BODY_BYTES,
      maxConcurrent: 32,
      factory: ({ requestInfo }) => createMcpServer({ scanner, rgaa, callerOf: callerOf(requestInfo, openaiRanges.current) }),
      // The error name only: the SDK's parse errors quote the request body, which may hold a scanned address.
      onerror: (error) => console.error(`[mcp] ${error.name}`),
    });
    entries.set(host, entry);
  }
  return entry;
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function pageRoute(request: Request, url: URL, env: Env): Response | undefined {
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  switch (url.pathname) {
    case "/":
      return homePage(`${url.origin}${MCP_PATH}`);
    case "/docs":
      return docsPage(`${url.origin}${MCP_PATH}`);
    case "/docs/":
    case "/privacy/":
    case "/terms/":
      return Response.redirect(`${url.origin}${url.pathname.slice(0, -1)}`, 308);
    case "/privacy":
      return privacyPage(env.POLICY_DATE);
    case "/terms":
      return termsPage(env.POLICY_DATE);
    case FONT_PATH:
    case MONO_FONT_PATH:
      // The path carries the font version: cached for a year.
      return new Response(url.pathname === FONT_PATH ? fontData : monoFontData, { headers: { "content-type": "font/woff2", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
    case FAVICON_PATH:
      return new Response(faviconSvg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
    case AXE_PATH:
      // Loaded by the scanned page with `crossorigin` and an SRI hash: it needs CORS, and nothing is logged.
      return new Response(axeSource, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "public, max-age=31536000, immutable",
          "access-control-allow-origin": "*",
          "cross-origin-resource-policy": "cross-origin",
          "x-content-type-options": "nosniff",
        },
      });
    case ICON_PATH:
      return new Response(iconPng, { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
    case "/robots.txt":
    case "/sitemap.xml":
    case "/llms.txt":
      return seoFile(url.pathname) ?? notFoundPage();
    case "/.well-known/openai-apps-challenge":
      return env.OPENAI_APPS_CHALLENGE ? text(200, env.OPENAI_APPS_CHALLENGE) : text(404, "Not found.");
    default:
      return notFoundPage();
  }
}

/** Body of a request or response, read up to `MAX_BODY_BYTES`; null past it. */
async function readCappedBody(message: Request | Response): Promise<Uint8Array<ArrayBuffer> | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (message.body) {
    const reader = message.body.getReader();
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      size += read.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
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
  return out;
}

/** JSON-RPC method and tool name for the log line, without arguments (lists in metrics.ts); `batch` for an array. */
function describe({ method, tool }: CallLabels): string {
  return `${method === "invalid" ? "?" : method}${tool ? ` ${tool}` : ""}`;
}

async function handleMcp(request: Request, url: URL, env: Env, tracker: Tracker): Promise<{ response: Response; what: string }> {
  if (request.method !== "POST") return { response: await entryFor(url.hostname, env).fetch(request), what: "" };
  const body = await readCappedBody(request);
  if (!body) {
    tracker.call({ method: "invalid", tool: "" });
    return { response: jsonRpcError(413, -32600, `Request body too large: at most ${MAX_BODY_BYTES} bytes.`), what: "" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    parsed = undefined;
  }
  const labels = mcpLabels(parsed);
  tracker.call(labels);
  const what = describe(labels);
  // One message per request: a batch of tool calls would start many browsers from a single request.
  if (Array.isArray(parsed)) return { response: jsonRpcError(400, -32600, "JSON-RPC batches are not accepted: send one message per request."), what };
  const response = await entryFor(url.hostname, env).fetch(new Request(request, { body }));
  return { response, what };
}

async function route(request: Request, url: URL, env: Env, ctx: ExecutionContext, tracker: Tracker): Promise<Response> {
  if (url.pathname !== MCP_PATH) return pageRoute(request, url, env) ?? text(404, "Not found.");
  const reloading = openaiRanges.reload();
  if (reloading) ctx.waitUntil(reloading);
  const started = Date.now();
  const { response, what } = await handleMcp(request, url, env, tracker);
  console.log(`${request.method} ${MCP_PATH}${what ? ` ${what}` : ""} → ${response.status} (${Date.now() - started} ms)`);
  // A tool call answers in a stream: its data point is written when the stream ends (abortOnCancel).
  if (request.method === "POST") tracker.respond(response.status, isEventStream(response));
  return response;
}

/**
 * Usage count of a POST /mcp request: the platform (the classification of callers.ts, from the address Cloudflare
 * saw, which is not kept), and nothing else of the caller. Never fails the request.
 */
function trackerFor(request: Request, url: URL, env: Env): Tracker {
  if (request.method !== "POST" || url.pathname !== MCP_PATH || !env.METRICS) return createTracker(undefined, "");
  try {
    return createTracker(env.METRICS, callerOf(request, openaiRanges.current)(undefined).platform);
  } catch {
    return createTracker(undefined, "");
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // An endpoint pasted with a trailing slash is served as the endpoint (audit A3-16).
    if (url.pathname === `${MCP_PATH}/`) {
      url.pathname = MCP_PATH;
      request = new Request(url, request);
    }
    const redirect = httpsRedirect(url);
    if (redirect) return redirect;
    const abort = new AbortController();
    const tracker = trackerFor(request, url, env);
    const scope: RequestScope = { waitUntil: (work) => ctx.waitUntil(work), signal: abort.signal, report: tracker.scan };
    const response = await requestScope.run(scope, () => route(request, url, env, ctx, tracker));
    return withHsts(abortOnCancel(response, abort, tracker.end));
  },
} satisfies ExportedHandler<Env>;

// Product name in logs, for the Cloudflare dashboard.
console.log(`${BRAND.name} ${BRAND.version} worker loaded`);
