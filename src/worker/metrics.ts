// Durable usage count: one Workers Analytics Engine data point per POST /mcp request (dataset `euroa11y_usage`,
// binding `METRICS`, wrangler.jsonc), kept 3 months by Cloudflare. The console logs last 7 days.
//
// What a point holds, in this order (positions are frozen once deployed: add at the end, never reorder):
//   index1   platform of the caller: chatgpt | claude | direct | other (src/callers.ts)
//   blob1    JSON-RPC method, from a fixed list: initialize, tools/list, tools/call, server/discover, ...,
//            `other` for any other text, `batch` for an array, `invalid` for a body that is not a message
//   blob2    tool name from a fixed list (scan_page, check_eaa_scope), `other`, or "" when the call names none
//   blob3    status of the call: ok | error | limit
//   blob4    scan result, "" when the call ran no scan: ok | cache | bot_protection | limit | error
//   double1  duration of the request in ms (for a tool call, until its answer is sent)
//   double2  duration of the scan in ms, 0 when the call ran no scan
// Nothing else, and nothing the caller writes: no address, no scanned page or host, no OpenAI subject, no hash,
// no argument. Every string comes from a list in this file.
//
// A metrics failure never reaches the request: the binding is optional, `writeDataPoint` is synchronous and
// not awaited, and every call here is inside a try/catch.
import { ScanError } from "../scan-core.ts";

/** What the Worker needs of the `analytics_engine_datasets` binding (structural: this file also builds under Node). */
export interface MetricsSink {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
}

export type CallStatus = "ok" | "error" | "limit";
export type ScanResult = "ok" | "cache" | "bot_protection" | "limit" | "error";

/** A scan refused by one of the service's limits (rate, daily scans, site, capacity), not failed. */
export class LimitError extends ScanError {}

const PLATFORMS = new Set(["chatgpt", "claude", "direct"]);

// Logged as they are; any other method or tool name is `other` (free text from the caller).
const KNOWN_METHODS = new Set(["initialize", "notifications/initialized", "notifications/cancelled", "ping", "server/discover", "subscriptions/listen", "tools/list", "tools/call", "resources/list", "prompts/list"]);
const KNOWN_TOOLS = new Set(["scan_page", "check_eaa_scope"]);

export interface CallLabels {
  method: string;
  tool: string;
}

/** JSON-RPC method and tool name of a parsed request body, from the fixed lists only; never the arguments. */
export function mcpLabels(body: unknown): CallLabels {
  if (Array.isArray(body)) return { method: "batch", tool: "" };
  if (typeof body !== "object" || body === null) return { method: "invalid", tool: "" };
  const { method, params } = body as { method?: unknown; params?: { name?: unknown } | null };
  const name = params?.name;
  return {
    method: typeof method === "string" && KNOWN_METHODS.has(method) ? method : "other",
    tool: name === undefined ? "" : typeof name === "string" && KNOWN_TOOLS.has(name) ? name : "other",
  };
}

/** How a scan ended, from its error: the bot protection messages of scan-core all say "bot protection". */
export function scanResultOf(error: unknown): ScanResult {
  if (error instanceof LimitError) return "limit";
  if (error instanceof ScanError && /bot protection/i.test(error.message)) return "bot_protection";
  return "error";
}

/** Status of the call: 503 and 429 are the limits of the HTTP entry; a failed scan fails the call. */
export function callStatus(httpStatus: number, scan?: ScanResult): CallStatus {
  if (httpStatus === 429 || httpStatus === 503 || scan === "limit") return "limit";
  if (httpStatus >= 400 || (scan !== undefined && scan !== "ok" && scan !== "cache")) return "error";
  return "ok";
}

export interface Usage extends CallLabels {
  platform: string;
  status: CallStatus;
  ms: number;
  scan?: { result: ScanResult; ms: number };
}

const duration = (ms: number) => (Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0);

/** The data point of one request, in the order documented at the top of this file. */
export function usagePoint(usage: Usage) {
  return {
    indexes: [PLATFORMS.has(usage.platform) ? usage.platform : "other"],
    blobs: [usage.method, usage.tool, usage.status, usage.scan?.result ?? ""],
    doubles: [duration(usage.ms), duration(usage.scan?.ms ?? 0)],
  };
}

/** Writes the data point; no binding, or a binding that fails, changes nothing for the request. */
export function recordUsage(sink: MetricsSink | undefined, usage: Usage): void {
  try {
    sink?.writeDataPoint(usagePoint(usage));
  } catch {
    // Counting is never worth a failed request.
  }
}

/** One request's usage, filled by the places that learn something about it, written once when it is over. */
export interface Tracker {
  /** The method and tool of the request, once its body is read. */
  call(labels: CallLabels): void;
  /** How the scan of this request ended; called by the scanner. */
  scan(result: ScanResult, ms: number): void;
  /** The answer is ready; `streaming` when its body is an event stream, which is still being sent. */
  respond(httpStatus: number, streaming: boolean): void;
  /** The event stream finished, or the client cancelled it. */
  end(cancelled: boolean): void;
}

const NOOP: Tracker = { call() {}, scan() {}, respond() {}, end() {} };

export function createTracker(sink: MetricsSink | undefined, platform: string, now: () => number = Date.now): Tracker {
  if (!sink) return NOOP;
  const started = now();
  let labels: CallLabels = { method: "invalid", tool: "" };
  let httpStatus: number | undefined;
  let scan: Usage["scan"];
  // Set when the answer is complete, which fixes the duration of the request.
  let over: number | undefined;
  let waitForScan = false;
  let written = false;

  const flush = () => {
    if (written || over === undefined || httpStatus === undefined || waitForScan) return;
    written = true;
    recordUsage(sink, { platform, ...labels, status: callStatus(httpStatus, scan?.result), ms: over - started, ...(scan ? { scan } : {}) });
  };
  const safe = (work: () => void) => () => {
    try {
      work();
    } catch {
      // Same rule as recordUsage.
    }
  };

  return {
    call: (value) => safe(() => void (labels = value))(),
    scan: (result, ms) =>
      safe(() => {
        scan ??= { result, ms };
        waitForScan = false;
        flush();
      })(),
    respond: (status, streaming) =>
      safe(() => {
        httpStatus = status;
        if (!streaming) over = now();
        flush();
      })(),
    end: (cancelled) =>
      safe(() => {
        over ??= now();
        // A client that leaves during a scan: the scan goes on under `waitUntil` and reports its result then.
        if (cancelled && labels.tool === "scan_page" && scan === undefined && httpStatus !== undefined && httpStatus < 400) waitForScan = true;
        flush();
      })(),
  };
}

export function isEventStream(response: Response): boolean {
  return response.body !== null && (response.headers.get("content-type") ?? "").startsWith("text/event-stream");
}

/**
 * The same response, whose body raises `abort` when the client cancels it; event streams only. `ended` is told
 * when the stream finishes or is cancelled: a tool call answers in a stream, so that is when the usage of the
 * request is complete.
 */
export function abortOnCancel(response: Response, abort: AbortController, ended?: (cancelled: boolean) => void): Response {
  if (!response.body || !isEventStream(response)) return response;
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let read;
      try {
        read = await reader.read();
      } catch (error) {
        ended?.(true);
        throw error;
      }
      if (read.done) {
        controller.close();
        ended?.(false);
      } else controller.enqueue(read.value);
    },
    cancel(reason) {
      abort.abort();
      ended?.(true);
      return reader.cancel(reason);
    },
  });
  return new Response(body, response);
}
