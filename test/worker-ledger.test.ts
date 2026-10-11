// Storage of the scan limits: what the Durable Object keeps, under which keys, and until when.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { BudgetLimits } from "../src/worker/budget.ts";
import { createLedger, type SyncKv } from "../src/worker/ledger.ts";

const NO_RESERVES = { chatgpt: { running: 0, share: 0 }, claude: { running: 0, share: 0 }, direct: { running: 0, share: 0 } };
const LIMITS: BudgetLimits = { dailyBudgetMs: 3_600_000, maxRunning: 8, reserveMs: 125_000, slotTtlMs: 90_000, reserves: NO_RESERVES, clientRunning: 1, clientDaily: 2, siteRunning: 2, siteHourly: 30 };
const NOON = Date.parse("2026-10-04T12:00:00Z");
const MIDNIGHT = Date.parse("2026-10-05T00:00:00Z");
const CLIENT = { platform: "direct", client: "ip:3232235777", site: "example.com" } as const;

/** In memory, values copied in and out as the Durable Object's storage does. */
function memoryKv(): SyncKv & { entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>();
  return {
    entries,
    get<T>(key: string) {
      return structuredClone(entries.get(key)) as T | undefined;
    },
    put(key, value) {
      entries.set(key, structuredClone(value));
    },
    delete: (key) => entries.delete(key),
    list<T>({ prefix }: { prefix: string }) {
      return [...entries].filter(([key]) => key.startsWith(prefix)) as Array<[string, T]>;
    },
  };
}

/** Random bytes that differ at each draw. */
function draws(): (size: number) => Uint8Array {
  let draw = 0;
  return (size) => new Uint8Array(size).fill((draw += 1));
}

const shape = (kv: { entries: Map<string, unknown> }) => [...kv.entries.keys()].map((key) => key.replace(/[0-9a-f]{64}$/, "…")).sort();

test("keeps clients and sites only as keyed hashes, under a key drawn for the day", () => {
  const kv = memoryKv();
  const ledger = createLedger(kv, draws());
  const outcome = ledger.admit(LIMITS, CLIENT, NOON);
  assert.equal(outcome.admission.status, "admitted");
  assert.equal(outcome.alarmAt, MIDNIGHT, "the alarm that deletes the day's key");
  assert.deepEqual(shape(kv), ["budget", "c:…", "day-key", "s:…"]);
  assert.doesNotMatch(JSON.stringify([...kv.entries]), /3232235777|example\.com/);
  assert.deepEqual(kv.entries.get("day-key"), { day: "2026-10-04", key: "01".repeat(32) });
  const [, count] = [...kv.entries].find(([key]) => key.startsWith("c:"))!;
  assert.equal(count, 1);

  if (outcome.admission.status === "admitted") ledger.release(outcome.admission.slot, 10_000);
  const again = ledger.admit(LIMITS, CLIENT, NOON + 1000);
  assert.equal(again.admission.status, "admitted");
  assert.equal(again.alarmAt, undefined, "same day, same key");
  assert.deepEqual(shape(kv), ["budget", "c:…", "day-key", "s:…"], "the same client and site, the same entries");
});

test("a refused scan writes nothing", () => {
  const kv = memoryKv();
  const ledger = createLedger(kv, draws());
  ledger.admit(LIMITS, CLIENT, NOON);
  const before = JSON.stringify([...kv.entries]);
  const refused = ledger.admit(LIMITS, { ...CLIENT, site: "other.example" }, NOON + 1000);
  assert.equal(refused.admission.status, "client_busy");
  assert.equal(refused.alarmAt, undefined);
  assert.equal(JSON.stringify([...kv.entries]), before);
});

test("charges the time billed when the slot is given back", () => {
  const kv = memoryKv();
  const ledger = createLedger(kv, draws());
  const { admission } = ledger.admit(LIMITS, CLIENT, NOON);
  assert.equal((kv.entries.get("budget") as { usedMs: number }).usedMs, 125_000);
  ledger.release(admission.status === "admitted" ? admission.slot : "", 10_000);
  assert.equal((kv.entries.get("budget") as { usedMs: number }).usedMs, 10_000);
  const before = JSON.stringify([...kv.entries]);
  ledger.release("unknown", 10_000);
  assert.equal(JSON.stringify([...kv.entries]), before);
});

test("a new day draws a new key and forgets the previous day's clients and sites", () => {
  const kv = memoryKv();
  kv.put("scans:2026-10-03", 12);
  kv.put("slots", {});
  const ledger = createLedger(kv, draws());
  for (const at of [NOON, NOON + 1000]) {
    const { admission } = ledger.admit(LIMITS, CLIENT, at);
    assert.equal(admission.status, "admitted");
    if (admission.status === "admitted") ledger.release(admission.slot, 10_000);
  }
  assert.equal(ledger.admit(LIMITS, CLIENT, NOON + 2000).admission.status, "client_daily");
  assert.deepEqual(shape(kv), ["budget", "c:…", "day-key", "s:…"], "the counts kept until 2026-10-04 are deleted");

  const tomorrow = ledger.admit(LIMITS, CLIENT, MIDNIGHT + 5000);
  assert.equal(tomorrow.admission.status, "admitted", "a new day, a new daily number");
  assert.equal(tomorrow.alarmAt, Date.parse("2026-10-06T00:00:00Z"));
  assert.deepEqual(kv.entries.get("day-key"), { day: "2026-10-05", key: "02".repeat(32) });
  assert.deepEqual(shape(kv), ["budget", "c:…", "day-key", "s:…"], "one client and one site, today's");
});

test("the alarm deletes the day's key and counts once the day is over", () => {
  const kv = memoryKv();
  const ledger = createLedger(kv, draws());
  assert.equal(ledger.expire(NOON), undefined, "nothing to delete");
  ledger.admit(LIMITS, CLIENT, NOON);
  assert.equal(ledger.expire(MIDNIGHT - 1), MIDNIGHT, "too early: kept, and the alarm set again");
  assert.deepEqual(shape(kv), ["budget", "c:…", "day-key", "s:…"]);
  assert.equal(ledger.expire(MIDNIGHT), undefined);
  assert.deepEqual(shape(kv), ["budget"], "only the totals of browser time stay");
});
