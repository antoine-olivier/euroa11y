// Scan limits (daily budget of browser time, simultaneous scans, per platform, client and site), cache of raw
// scans, and the note a reused result adds to the report.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Platform } from "../src/callers.ts";
import { buildReport, renderMarkdown } from "../src/report.ts";
import type { RawScan, ScanRequest } from "../src/scan-core.ts";
import { admit, settle, type Applicant, type BudgetLimits, type BudgetState } from "../src/worker/budget.ts";
import { createScanCache, type CacheStore } from "../src/worker/scan-cache.ts";

const NO_RESERVES = { chatgpt: { running: 0, share: 0 }, claude: { running: 0, share: 0 }, direct: { running: 0, share: 0 } };
const LIMITS: BudgetLimits = { dailyBudgetMs: 300_000, maxRunning: 2, reserveMs: 125_000, slotTtlMs: 90_000, reserves: NO_RESERVES, clientRunning: 1, clientDaily: 3, siteRunning: 2, siteHourly: 4 };
const NOON = Date.parse("2026-10-04T12:00:00Z");

/** A scan of its own site by a client the platform does not name. */
function scan(site: string, platform: Platform = "direct", more: Partial<Applicant> = {}): Applicant {
  return { platform, clientScans: 0, site, siteStarts: [], ...more };
}

test("reserves the worst case, then charges the time actually billed", () => {
  const first = admit(undefined, NOON, LIMITS, scan("a"), "a");
  assert.equal(first.admission.status, "admitted");
  assert.equal(first.state.usedMs, 125_000);
  assert.equal(first.state.platformMs?.direct, 125_000);
  const settled = settle(first.state, "a", 12_000);
  assert.equal(settled?.usedMs, 12_000);
  assert.equal(settled?.platformMs?.direct, 12_000, "the platform's share is charged the same way");
  assert.deepEqual(settled?.slots, {});
  assert.equal(settle(settled, "a", 12_000), undefined, "a slot is given back once");
});

test("refuses past the budget and past the simultaneous scans", () => {
  let state: BudgetState | undefined;
  ({ state } = admit(state, NOON, LIMITS, scan("a"), "a"));
  ({ state } = admit(state, NOON, LIMITS, scan("b"), "b"));
  assert.equal(admit(state, NOON, LIMITS, scan("c"), "c").admission.status, "busy");
  state = settle(settle(state, "a", 125_000), "b", 125_000);
  assert.equal(state?.usedMs, 250_000);
  assert.deepEqual(admit(state, NOON, LIMITS, scan("c"), "c").admission, { status: "budget", retryAt: Date.parse("2026-10-05T00:00:00Z") }, "50 s left, 125 s needed");
});

test("starts a new budget each UTC day and keeps a lost call's reservation", () => {
  const { state } = admit(undefined, NOON, LIMITS, scan("lost"), "lost");
  // Past its time to live, the slot is freed but its 125 s stay charged.
  const later = admit(state, NOON + 100_000, LIMITS, scan("b"), "b");
  assert.equal(later.state.usedMs, 250_000);
  assert.ok(!("lost" in later.state.slots));
  const tomorrow = admit(later.state, Date.parse("2026-10-05T00:00:01Z"), LIMITS, scan("c"), "c");
  assert.equal(tomorrow.state.usedMs, 125_000);
  assert.deepEqual(tomorrow.state.platformMs, { direct: 125_000 }, "the platforms' shares start again too");
});

test("a scan running across midnight gives nothing back to the new day", () => {
  const { state } = admit(undefined, Date.parse("2026-10-04T23:59:30Z"), LIMITS, scan("night"), "night");
  const tomorrow = admit(state, Date.parse("2026-10-05T00:00:10Z"), LIMITS, scan("c"), "c");
  assert.equal(tomorrow.state.usedMs, 125_000);
  assert.equal(settle(tomorrow.state, "night", 10_000)?.usedMs, 125_000);
});

test("reads a state and slots stored before the per-client limits", () => {
  const former: BudgetState = { day: "2026-10-04", usedMs: 125_000, slots: { old: { day: "2026-10-04", until: NOON + 60_000, reservedMs: 125_000 } } };
  const next = admit(former, NOON, LIMITS, scan("a"), "a");
  assert.equal(next.admission.status, "admitted");
  assert.equal(admit(next.state, NOON, LIMITS, scan("b"), "b").admission.status, "busy", "the old slot still counts");
  assert.equal(settle(next.state, "old", 10_000)?.usedMs, 135_000);
});

test("a client runs one scan at a time, up to its daily number", () => {
  const client = (clientScans: number, site: string) => scan(site, "chatgpt", { client: "c:1", clientScans });
  const first = admit(undefined, NOON, { ...LIMITS, maxRunning: 5 }, client(0, "a"), "a");
  assert.equal(first.admission.status, "admitted");
  assert.equal(first.state.slots.a?.client, "c:1");
  assert.equal(admit(first.state, NOON, { ...LIMITS, maxRunning: 5 }, client(1, "b"), "b").admission.status, "client_busy");
  assert.equal(admit(first.state, NOON, { ...LIMITS, maxRunning: 5 }, scan("b", "chatgpt", { client: "c:2" }), "b").admission.status, "admitted", "another client is not held up");
  const done = settle(first.state, "a", 10_000);
  assert.equal(admit(done, NOON, LIMITS, client(2, "b"), "b").admission.status, "admitted");
  assert.deepEqual(admit(done, NOON, LIMITS, client(3, "b"), "b").admission, { status: "client_daily", retryAt: Date.parse("2026-10-05T00:00:00Z") });
  // A platform that names no user: its calls share the platform's limits only.
  let state: BudgetState | undefined;
  ({ state } = admit(state, NOON, LIMITS, scan("a", "claude"), "a"));
  assert.equal(admit(state, NOON, LIMITS, scan("b", "claude"), "b").admission.status, "admitted");
});

test("a site gets a few scans at a time and per hour", () => {
  const limits = { ...LIMITS, maxRunning: 5, dailyBudgetMs: 3_000_000 };
  const site = (siteStarts: readonly number[]) => scan("site", "direct", { siteStarts });
  let { state, siteStarts } = admit(undefined, NOON, limits, site([]), "s0");
  ({ state, siteStarts } = admit(state, NOON + 1000, limits, site(siteStarts), "s1"));
  assert.deepEqual(siteStarts, [NOON, NOON + 1000]);
  assert.equal(admit(state, NOON + 2000, limits, site(siteStarts), "x").admission.status, "site_busy", "two at a time");
  ({ state, siteStarts } = admit(settle(settle(state, "s0", 1000), "s1", 1000), NOON + 2000, limits, site(siteStarts), "s2"));
  ({ state, siteStarts } = admit(settle(state, "s2", 1000), NOON + 3000, limits, site(siteStarts), "s3"));
  const done = settle(state, "s3", 1000);
  // Four in the hour: the next one is admitted once the oldest is an hour old.
  assert.deepEqual(admit(done, NOON + 4000, limits, site(siteStarts), "y").admission, { status: "site_hourly", retryAt: NOON + 3600_000 });
  const later = admit(done, NOON + 3600_000, limits, site(siteStarts), "y");
  assert.equal(later.admission.status, "admitted");
  assert.deepEqual(later.siteStarts, [NOON + 1000, NOON + 2000, NOON + 3000, NOON + 3600_000], "starts older than an hour are dropped");
});

test("each platform keeps browsers and a share of the day that the others cannot take", () => {
  const reserves = { chatgpt: { running: 1, share: 0.3 }, claude: { running: 1, share: 0.3 }, direct: { running: 1, share: 0.1 } };
  const limits: BudgetLimits = { ...LIMITS, maxRunning: 4, dailyBudgetMs: 1_000_000, reserveMs: 100_000, reserves, siteRunning: 9, siteHourly: 99 };
  let state: BudgetState | undefined;
  // Direct clients get their own browser and the shared one, never the two kept for ChatGPT and Claude.
  ({ state } = admit(state, NOON, limits, scan("a"), "d1"));
  ({ state } = admit(state, NOON, limits, scan("b"), "d2"));
  assert.equal(admit(state, NOON, limits, scan("c"), "d3").admission.status, "busy");
  ({ state } = admit(state, NOON, limits, scan("c", "chatgpt"), "g1"));
  ({ state } = admit(state, NOON, limits, scan("d", "claude"), "k1"));
  assert.equal(Object.keys(state?.slots ?? {}).length, 4);
  assert.equal(admit(state, NOON, limits, scan("e", "chatgpt"), "g2").admission.status, "busy", "all browsers taken");

  // Budget: 30 % kept for ChatGPT and 30 % for Claude while they have not used them.
  let day: BudgetState | undefined;
  for (let index = 0; index < 4; index += 1) {
    ({ state: day } = admit(day, NOON, limits, scan(`p${index}`), `p${index}`));
    day = settle(day, `p${index}`, 100_000);
  }
  assert.equal(day?.usedMs, 400_000);
  assert.equal(admit(day, NOON, limits, scan("p4"), "p4").admission.status, "budget", "the rest is kept for the other platforms");
  const chatgpt = admit(day, NOON, limits, scan("p4", "chatgpt"), "g");
  assert.equal(chatgpt.admission.status, "admitted", "ChatGPT still has its share and the part Claude does not keep");
});

function memoryStore(): CacheStore & { entries: Map<string, ArrayBuffer> } {
  const entries = new Map<string, ArrayBuffer>();
  return {
    entries,
    async match(request) {
      const body = entries.get(request.url);
      return body ? new Response(body.slice(0)) : undefined;
    },
    async put(request, response) {
      entries.set(request.url, await response.arrayBuffer());
    },
  };
}

const RAW: RawScan = {
  requestedUrl: "https://example.com/private-path?token=abc",
  finalUrl: "https://example.com/private-path?token=abc",
  httpStatus: 200,
  title: "Example",
  lang: "en",
  scannedAt: "2026-10-04T12:00:00.000Z",
  axeVersion: "4.13.0",
  viewport: { width: 1280, height: 800 },
  tags: ["wcag2a", "wcag2aa"],
  blockedRequests: 0,
  results: { violations: [], incomplete: [], passes: [] },
};

const REQUEST: ScanRequest = { url: new URL(RAW.requestedUrl), bestPractices: false, viewport: { width: 1280, height: 800 } };

test("reuses a scan for the same request only, stored without the address in clear", async () => {
  const store = memoryStore();
  let now = NOON;
  const cache = createScanCache(store, "https://euroa11y.com", 86_400, () => now);
  assert.equal(await cache.get(REQUEST), undefined);
  await cache.put(REQUEST, RAW);
  assert.equal(store.entries.size, 1);
  const [key, body] = [...store.entries][0]!;
  assert.ok(!key.includes("example.com") && !key.includes("token"), "the key is a hash");
  assert.ok(!new TextDecoder().decode(body).includes("example.com"), "the entry is encrypted");

  const hit = await cache.get(REQUEST);
  assert.equal(hit?.title, "Example");
  assert.equal(hit?.reusedUntil, "2026-10-05T12:00:00.000Z");
  assert.equal(hit?.rescanFrom, "2026-10-04T12:05:00.000Z");
  assert.equal(await cache.get({ ...REQUEST, viewport: { width: 390, height: 844 } }), undefined, "other options, other entry");
  assert.equal(await cache.get({ ...REQUEST, url: new URL("https://example.com/") }), undefined);

  now += 86_400_000;
  assert.equal(await cache.get(REQUEST), undefined, "expired");
});

test("a request for a fresh scan skips the cache once the result is five minutes old", async () => {
  const store = memoryStore();
  let now = NOON;
  const cache = createScanCache(store, "https://euroa11y.com", 86_400, () => now);
  await cache.put(REQUEST, RAW);
  now = NOON + 4 * 60_000;
  assert.equal((await cache.get({ ...REQUEST, fresh: true }))?.title, "Example", "too recent: reused, with the time a new scan is accepted");
  now = NOON + 5 * 60_000;
  assert.equal(await cache.get({ ...REQUEST, fresh: true }), undefined, "old enough: scanned again");
  assert.equal((await cache.get(REQUEST))?.title, "Example", "without fresh, still reused");
  await cache.put(REQUEST, { ...RAW, scannedAt: "2026-10-04T12:05:00.000Z", title: "Fixed" });
  assert.equal((await cache.get({ ...REQUEST, fresh: true }))?.title, "Fixed", "the new scan replaces the entry");
});

test("an entry larger than the cache allows is not kept", async () => {
  const store = memoryStore();
  const huge = { ...RAW, title: "x".repeat(300_000) };
  await createScanCache(store, "https://euroa11y.com", 86_400).put(REQUEST, huge);
  assert.equal(store.entries.size, 0);
});

test("a broken cache never fails the scan", async () => {
  const broken: CacheStore = {
    match: () => Promise.reject(new Error("down")),
    put: () => Promise.reject(new Error("down")),
  };
  const cache = createScanCache(broken, "https://euroa11y.com", 86_400);
  await cache.put(REQUEST, RAW);
  assert.equal(await cache.get(REQUEST), undefined);
  const store = memoryStore();
  await createScanCache(store, "https://euroa11y.com", 86_400).put(REQUEST, RAW);
  for (const [key, body] of store.entries) store.entries.set(key, new Uint8Array(body).map((byte) => byte ^ 1).buffer);
  assert.equal(await createScanCache(store, "https://euroa11y.com", 86_400).get(REQUEST), undefined, "tampered entry ignored");
});

test("a reused result says so first, with when it was scanned and how to scan again", () => {
  const scanned = buildReport(RAW);
  assert.equal(scanned.reused_until, undefined);
  assert.doesNotMatch(renderMarkdown(scanned), /Reused result/);
  const reused = buildReport({ ...RAW, reusedUntil: "2026-10-05T12:00:00.000Z", rescanFrom: "2026-10-04T12:05:00.000Z" });
  assert.equal(reused.reused_until, "2026-10-05T12:00:00.000Z");
  assert.equal(reused.rescan_from, "2026-10-04T12:05:00.000Z");
  const lines = renderMarkdown(reused).split("\n");
  const at = lines.findIndex((line) => line.startsWith("Reused result"));
  assert.ok(at > 0 && at < lines.findIndex((line) => line.startsWith("WCAG failures")), "before the figures");
  assert.match(lines[at] ?? "", /2026-10-04T12:00:00\.000Z.*2026-10-05T12:00:00\.000Z.*fresh: true \(accepted from 2026-10-04T12:05:00\.000Z\)/);
});
