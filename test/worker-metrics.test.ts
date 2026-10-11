// Usage count of the Workers build (src/worker/metrics.ts): the data point holds only values from fixed lists,
// the binding is optional and never fails a request, and the scanner reports how each scan ended.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import type { RawScan, ScanRequest } from "../src/scan-core.ts";

// Real scan-core except `scanInBrowser`, which here ends as the test says; Browser Run is a fake that never opens a page.
const actualCore = await import("../src/scan-core.ts");
let scanEnds: () => Promise<RawScan>;
mock.module("../src/scan-core.ts", { exports: { ...actualCore, scanInBrowser: () => scanEnds() } });
mock.module("@cloudflare/playwright", { exports: { launch: async () => ({ close: async () => {} }) } });
const { createCloudflareScanner } = await import("../src/worker/scanner-cf.ts");
const { abortOnCancel, callStatus, isEventStream, createTracker, LimitError, mcpLabels, recordUsage, scanResultOf, usagePoint } = await import("../src/worker/metrics.ts");
type Point = { indexes?: string[]; blobs?: string[]; doubles?: number[] };

function sink() {
  const points: Point[] = [];
  return { points, writeDataPoint: (point: Point) => void points.push(point) };
}

test("method and tool come from fixed lists: free text from the caller becomes `other`", () => {
  assert.deepEqual(mcpLabels({ method: "tools/call", params: { name: "scan_page", arguments: { url: "https://secret.example/" } } }), { method: "tools/call", tool: "scan_page" });
  assert.deepEqual(mcpLabels({ method: "tools/call", params: { name: "https://secret.example/" } }), { method: "tools/call", tool: "other" });
  assert.deepEqual(mcpLabels({ method: "https://secret.example/", params: { name: 42 } }), { method: "other", tool: "other" });
  assert.deepEqual(mcpLabels({ method: "initialize", params: null }), { method: "initialize", tool: "" });
  assert.deepEqual(mcpLabels({ method: "server/discover" }), { method: "server/discover", tool: "" });
  assert.deepEqual(mcpLabels([{}]), { method: "batch", tool: "" });
  assert.deepEqual(mcpLabels(undefined), { method: "invalid", tool: "" });
  assert.deepEqual(mcpLabels("tools/call"), { method: "invalid", tool: "" });
});

test("the data point has the documented fields in the documented order", () => {
  const point = usagePoint({ platform: "chatgpt", method: "tools/call", tool: "scan_page", status: "ok", ms: 12_345.6, scan: { result: "bot_protection", ms: 9_000.2 } });
  assert.deepEqual(point, { indexes: ["chatgpt"], blobs: ["tools/call", "scan_page", "ok", "bot_protection"], doubles: [12_346, 9_000] });
  assert.deepEqual(usagePoint({ platform: "claude", method: "tools/list", tool: "", status: "ok", ms: -5 }), { indexes: ["claude"], blobs: ["tools/list", "", "ok", ""], doubles: [0, 0] });
  assert.deepEqual(usagePoint({ platform: "203.0.113.7", method: "ping", tool: "", status: "error", ms: Number.NaN }).indexes, ["other"], "a platform outside the list is not written");
});

test("the query script reads the columns the Worker writes", () => {
  const run = spawnSync(process.execPath, ["scripts/usage.mjs", "--print-sql"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
  assert.equal(run.status, 0, run.stderr);
  const sql = run.stdout;
  assert.match(sql, /index1 AS platform/);
  assert.match(sql, /blob1 AS method/);
  assert.match(sql, /blob2 AS tool/);
  assert.match(sql, /blob3 AS status/);
  assert.match(sql, /blob4 AS result/);
  assert.match(sql, /double2/);
  assert.match(sql, /FROM euroa11y_usage/);
  assert.match(sql, /INTERVAL '30' DAY/);
  assert.match(sql, /INTERVAL '90' DAY/);
  assert.doesNotMatch(sql, /COUNT\(/, "counts are corrected for sampling");
  const without = spawnSync(process.execPath, ["scripts/usage.mjs"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
  assert.equal(without.status, 2, "no credentials, no call");
  assert.match(without.stderr, /CLOUDFLARE_API_TOKEN/);
  assert.equal(readFileSync("wrangler.jsonc", "utf8").includes('"dataset": "euroa11y_usage"'), true);
  assert.match(readFileSync("wrangler.jsonc", "utf8"), /"binding": "METRICS"/);
});

test("no binding, or a binding that throws, changes nothing", () => {
  const usage = { platform: "direct", method: "ping", tool: "", status: "ok", ms: 1 } as const;
  assert.doesNotThrow(() => recordUsage(undefined, usage));
  assert.doesNotThrow(() =>
    recordUsage(
      {
        writeDataPoint: () => {
          throw new Error("dataset unavailable");
        },
      },
      usage,
    ),
  );
  const none = createTracker(undefined, "chatgpt");
  assert.doesNotThrow(() => {
    none.call({ method: "ping", tool: "" });
    none.respond(200, false);
    none.end(false);
  });
  const broken = createTracker(
    {
      writeDataPoint: () => {
        throw new Error("dataset unavailable");
      },
    },
    "claude",
  );
  assert.doesNotThrow(() => {
    broken.call({ method: "ping", tool: "" });
    broken.respond(200, false);
  });
});

test("status of a call: limits, errors, and a scan that failed", () => {
  assert.equal(callStatus(200), "ok");
  assert.equal(callStatus(202), "ok");
  assert.equal(callStatus(200, "ok"), "ok");
  assert.equal(callStatus(200, "cache"), "ok");
  assert.equal(callStatus(200, "bot_protection"), "error");
  assert.equal(callStatus(200, "error"), "error");
  assert.equal(callStatus(200, "limit"), "limit");
  assert.equal(callStatus(503), "limit");
  assert.equal(callStatus(429), "limit");
  assert.equal(callStatus(400), "error");
  assert.equal(callStatus(413), "error");
});

test("scan results: limit, bot protection (both scan-core messages), anything else is an error", () => {
  assert.equal(scanResultOf(new LimitError("Too many scans are running right now.")), "limit");
  assert.equal(scanResultOf(new actualCore.ScanError("The site's bot protection (DataDome, HTTP 403) refused the scanning browser and served a challenge page.")), "bot_protection");
  assert.equal(scanResultOf(new actualCore.ScanError("The site refused the scanning browser (HTTP 403), probably through bot protection or a login wall.")), "bot_protection");
  assert.equal(scanResultOf(new actualCore.ScanError("Domain not found: example.invalid.")), "error");
  assert.equal(scanResultOf(new Error("bot protection")), "error", "only the scanner's own errors are read");
  assert.equal(scanResultOf("boom"), "error");
  // scan-core's messages are the ones read above: the day they change, this test must change with the classifier.
  const source = readFileSync("src/scan-core.ts", "utf8");
  assert.match(source, /The site's bot protection \(\$\{vendor\}/);
  assert.match(source, /probably through bot protection or a login wall/);
});

test("one data point per request, written when the answer is complete", () => {
  const out = sink();
  const direct = createTracker(out, "direct", () => 1_000);
  direct.call({ method: "tools/list", tool: "" });
  direct.respond(200, false);
  assert.deepEqual(out.points, [{ indexes: ["direct"], blobs: ["tools/list", "", "ok", ""], doubles: [0, 0] }]);
  direct.end(false);
  assert.equal(out.points.length, 1, "written once");

  let time = 0;
  const streamed = createTracker(out, "chatgpt", () => time);
  streamed.call({ method: "tools/call", tool: "scan_page" });
  streamed.respond(200, true);
  assert.equal(out.points.length, 1, "a stream is still being sent");
  time = 7_500;
  streamed.scan("ok", 7_000);
  streamed.end(false);
  assert.deepEqual(out.points[1], { indexes: ["chatgpt"], blobs: ["tools/call", "scan_page", "ok", "ok"], doubles: [7_500, 7_000] });

  const refused = createTracker(out, "claude");
  refused.call({ method: "tools/call", tool: "scan_page" });
  refused.scan("limit", 3);
  refused.respond(200, true);
  refused.end(false);
  assert.deepEqual(out.points[2]?.blobs, ["tools/call", "scan_page", "limit", "limit"]);

  const busy = createTracker(out, "direct");
  busy.call({ method: "tools/call", tool: "scan_page" });
  busy.respond(503, false);
  assert.deepEqual(out.points[3]?.blobs, ["tools/call", "scan_page", "limit", ""]);
});

test("a client that leaves during a scan: the point waits for the scan's result", () => {
  const out = sink();
  const tracker = createTracker(out, "claude");
  tracker.call({ method: "tools/call", tool: "scan_page" });
  tracker.respond(200, true);
  tracker.end(true);
  assert.equal(out.points.length, 0);
  tracker.scan("ok", 4_000);
  assert.equal(out.points.length, 1);
  assert.deepEqual(out.points[0]?.blobs, ["tools/call", "scan_page", "ok", "ok"]);
  tracker.scan("error", 1);
  assert.equal(out.points.length, 1, "written once");
  // Another tool, or a call that failed before any scan: nothing to wait for.
  const other = createTracker(out, "claude");
  other.call({ method: "tools/call", tool: "check_eaa_scope" });
  other.respond(200, true);
  other.end(true);
  assert.equal(out.points.length, 2);
});

test("a data point never holds an address, a host, an identifier or a hash", () => {
  const out = sink();
  const tracker = createTracker(out, "chatgpt");
  const body = { method: "tools/call", params: { name: "scan_page", arguments: { url: "https://private.example/secret" }, _meta: { "openai/subject": "user-123" } } };
  tracker.call(mcpLabels(body));
  tracker.scan("ok", 10);
  tracker.respond(200, false);
  const written = JSON.stringify(out.points);
  for (const leak of ["private.example", "secret", "user-123", "openai/subject", "203.0.113", "https://"]) assert.equal(written.includes(leak), false, leak);
});

test("the event stream tells when it ends or is cancelled, and passes its bytes unchanged", async () => {
  const stream = (chunks: string[]) => new Response(new ReadableStream<Uint8Array>({ start: (controller) => (chunks.forEach((chunk) => controller.enqueue(new TextEncoder().encode(chunk))), controller.close()) }), { headers: { "content-type": "text/event-stream" } });
  const ended: boolean[] = [];
  const done = abortOnCancel(stream(["data: a\n\n", "data: b\n\n"]), new AbortController(), (cancelled) => void ended.push(cancelled));
  assert.equal(await done.text(), "data: a\n\ndata: b\n\n");
  assert.deepEqual(ended, [false]);

  const abort = new AbortController();
  const left = abortOnCancel(stream(["data: a\n\n"]), abort, (cancelled) => void ended.push(cancelled));
  await left.body?.cancel();
  assert.equal(abort.signal.aborted, true);
  assert.deepEqual(ended, [false, true]);

  const json = new Response("{}", { headers: { "content-type": "application/json" } });
  assert.equal(abortOnCancel(json, new AbortController(), () => assert.fail("not a stream")), json);
  assert.equal(isEventStream(json), false);
  assert.equal(isEventStream(new Response(null, { status: 202, headers: { "content-type": "text/event-stream" } })), false, "no body, no stream");
});

const REQUEST: ScanRequest = { url: new URL("https://example.com/"), bestPractices: false, viewport: { width: 1280, height: 800 }, fresh: false };
const RAW = { url: "https://example.com/" } as unknown as RawScan;

/** A scanner whose reports are collected; `scanEnds` decides how the scan itself ends. */
function setup(options: { cached?: RawScan; verdict?: "private_address" | null; refuse?: Error } = {}) {
  const reports: Array<[string, number]> = [];
  const work: Promise<unknown>[] = [];
  const scanner = createCloudflareScanner({} as never, {
    checkHost: async () => options.verdict ?? null,
    axe: { source: "", version: "0" },
    admit: async () => {
      if (options.refuse) throw options.refuse;
      return async () => {};
    },
    cache: { get: async () => options.cached, put: async () => {} } as never,
    scope: () => ({ waitUntil: (promise) => void work.push(promise), signal: new AbortController().signal, report: (result, ms) => void reports.push([result, ms]) }),
  });
  return { scanner, reports, work };
}

test("the scanner reports a result for every way a scan can end, and only that", async () => {
  scanEnds = async () => RAW;
  const ok = setup();
  assert.equal(await ok.scanner.scan(REQUEST), RAW);
  await Promise.all(ok.work);
  assert.deepEqual(ok.reports.map(([result]) => result), ["ok"]);
  assert.equal(typeof ok.reports[0]?.[1], "number");

  const cache = setup({ cached: RAW });
  await cache.scanner.scan(REQUEST);
  assert.deepEqual(cache.reports.map(([result]) => result), ["cache"]);

  const refusedAddress = setup({ verdict: "private_address" });
  await assert.rejects(refusedAddress.scanner.scan(REQUEST), /private or local/);
  assert.deepEqual(refusedAddress.reports.map(([result]) => result), ["error"]);

  const limited = setup({ refuse: new LimitError("Today's free scanning capacity is used up.") });
  await assert.rejects(limited.scanner.scan(REQUEST), /capacity/);
  await Promise.all(limited.work);
  assert.deepEqual(limited.reports.map(([result]) => result), ["limit"]);

  scanEnds = async () => {
    throw new actualCore.ScanError("The site's bot protection (DataDome, HTTP 403) refused the scanning browser and served a challenge page instead of the site.");
  };
  const blocked = setup();
  await assert.rejects(blocked.scanner.scan(REQUEST), /bot protection/);
  await Promise.all(blocked.work);
  assert.deepEqual(blocked.reports.map(([result]) => result), ["bot_protection"]);

  scanEnds = async () => {
    throw new Error("Target closed");
  };
  const failed = setup();
  await assert.rejects(failed.scanner.scan(REQUEST), /Target closed/);
  await Promise.all(failed.work);
  assert.deepEqual(failed.reports.map(([result]) => result), ["error"]);
});

test("a metrics report that throws does not fail the scan", async () => {
  scanEnds = async () => RAW;
  const scanner = createCloudflareScanner({} as never, {
    checkHost: async () => null,
    axe: { source: "", version: "0" },
    admit: async () => async () => {},
    cache: { get: async () => undefined, put: async () => {} } as never,
    scope: () => ({
      waitUntil: () => {},
      signal: new AbortController().signal,
      report: () => {
        throw new Error("metrics down");
      },
    }),
  });
  assert.equal(await scanner.scan(REQUEST), RAW);
});
