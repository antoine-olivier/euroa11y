// Storage side of the scan limits (rules in budget.ts), on the synchronous key-value storage of the DailyQuota
// Durable Object: each call runs to its end before the next one starts, so every count stays exact. Clients
// and scanned sites are stored only as HMAC-SHA-256 hashes under a key of 32 random bytes drawn for each UTC
// day. That key, the clients' counts and the sites' start times are deleted once the day is over, by the
// first call of the next day or by the alarm set for midnight (QCM of 2026-10-05). A refused scan writes
// nothing, apart from the day's key when it is the day's first call.
import { createHmac } from "node:crypto";
import type { Platform } from "../callers.ts";
import { admit, nextUtcDay, settle, utcDay, type Admission, type BudgetLimits, type BudgetState } from "./budget.ts";

/** The part of the Durable Object's synchronous key-value storage (`ctx.storage.kv`) used here. */
export interface SyncKv {
  get<T>(key: string): T | undefined;
  put<T>(key: string, value: T): void;
  delete(key: string): boolean;
  list<T>(options: { prefix: string }): Iterable<[string, T]>;
}

export interface ScanApplication {
  platform: Platform;
  /** The client's identifier in clear (network address or platform user id): hashed, never stored. */
  client?: string;
  /** Host name of the page to scan. */
  site: string;
}

interface DayKey {
  day: string;
  key: string;
}

const BUDGET = "budget";
const DAY_KEY = "day-key";
const CLIENT = "c:";
const SITE = "s:";
// Count of scans per day and slot list kept until 2026-10-04.
const FORMER = ["scans:"];

export interface Ledger {
  /** `alarmAt`: set when a new day key was drawn, the time of the alarm that deletes it. */
  admit(limits: BudgetLimits, application: ScanApplication, now: number): { admission: Admission; alarmAt?: number };
  /** Gives the slot back, charging the browser time actually billed. */
  release(slot: string, billedMs: number): void;
  /** For the alarm: deletes a past day's key and counts; returns when to run again, if still needed. */
  expire(now: number): number | undefined;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createLedger(kv: SyncKv, randomBytes: (size: number) => Uint8Array = (size) => crypto.getRandomValues(new Uint8Array(size))): Ledger {
  function purge(): void {
    for (const prefix of [CLIENT, SITE, ...FORMER]) {
      const keys = Array.from(kv.list({ prefix }), ([key]) => key);
      for (const key of keys) kv.delete(key);
    }
    kv.delete("slots");
    kv.delete(DAY_KEY);
  }

  return {
    admit(limits, application, now) {
      const day = utcDay(now);
      const stored = kv.get<DayKey>(DAY_KEY);
      const dayKey = stored?.day === day ? stored : { day, key: hex(randomBytes(32)) };
      if (dayKey !== stored) {
        purge();
        kv.put(DAY_KEY, dayKey);
      }
      const hash = (kind: string, value: string) => createHmac("sha256", dayKey.key).update(`${kind}\n${value}`).digest("hex");
      const client = application.client === undefined ? undefined : `${CLIENT}${hash("client", application.client)}`;
      const site = `${SITE}${hash("site", application.site)}`;
      const clientScans = client === undefined ? 0 : (kv.get<number>(client) ?? 0);
      const outcome = admit(kv.get<BudgetState>(BUDGET), now, limits, { platform: application.platform, client, clientScans, site, siteStarts: kv.get<number[]>(site) ?? [] }, crypto.randomUUID());
      if (outcome.admission.status === "admitted") {
        kv.put(BUDGET, outcome.state);
        kv.put(site, outcome.siteStarts);
        if (client !== undefined) kv.put(client, clientScans + 1);
      }
      return dayKey === stored ? { admission: outcome.admission } : { admission: outcome.admission, alarmAt: nextUtcDay(now) };
    },

    release(slot, billedMs) {
      const next = settle(kv.get<BudgetState>(BUDGET), slot, billedMs);
      if (next) kv.put(BUDGET, next);
    },

    expire(now) {
      const stored = kv.get<DayKey>(DAY_KEY);
      if (!stored) return undefined;
      // An alarm that fires before midnight keeps the day's key.
      if (stored.day === utcDay(now)) return nextUtcDay(now);
      purge();
      return undefined;
    },
  };
}
