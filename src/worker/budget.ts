// Limits on the scans of the public server: pure state changes, held by the DailyQuota Durable Object.
// Browser Run bills browser time per second, added up per day, and simultaneous browsers beyond the 10
// included. A scan reserves the longest time it could be billed before its browser starts, and gives back
// the unused part once the browser is closed: the day's total never passes the budget.
// Per-client limits (audit A1-01, QCM of 2026-10-05): ChatGPT, Claude on the web and the other clients each
// keep a reserve of browsers and of the day's time that the others cannot take, the rest is shared. A client
// (one ChatGPT user, one machine) runs one scan at a time, up to a number per day; a scanned site gets a few
// scans at a time and per hour. Clients and sites arrive here as keyed hashes (ledger.ts).
import type { Platform } from "../callers.ts";

export const PLATFORMS: readonly Platform[] = ["chatgpt", "claude", "direct"];

const HOUR_MS = 3600_000;

export interface Slot {
  /** UTC day the reservation was charged to. */
  day: string;
  /** Past this time the slot is freed: its call was lost, and its whole reservation stays charged. */
  until: number;
  reservedMs: number;
  /** Absent from the slots stored before 2026-10-05, which count in the total only. */
  platform?: Platform;
  client?: string;
  site?: string;
}

export interface BudgetState {
  day: string;
  usedMs: number;
  /** Time charged to each platform this day; absent from the states stored before 2026-10-05. */
  platformMs?: Partial<Record<Platform, number>>;
  slots: Record<string, Slot>;
}

export interface BudgetLimits {
  dailyBudgetMs: number;
  maxRunning: number;
  /** Longest browser time one scan can be billed. */
  reserveMs: number;
  slotTtlMs: number;
  /** Browsers, and share of the daily budget (0 to 1), kept for each platform. */
  reserves: Record<Platform, { running: number; share: number }>;
  /** Scans one client may run at once, and start per UTC day. */
  clientRunning: number;
  clientDaily: number;
  /** Scans of one site at once, and started per hour. */
  siteRunning: number;
  siteHourly: number;
}

/** The scan asking to start, with what the store holds about its client and site. */
export interface Applicant {
  platform: Platform;
  /** Keyed hash of the client, when the platform names one. */
  client?: string;
  /** Scans the client started this day. */
  clientScans: number;
  /** Keyed hash of the scanned site. */
  site: string;
  /** Start times of the site's recent scans. */
  siteStarts: readonly number[];
}

export type Refusal = "busy" | "budget" | "client_busy" | "client_daily" | "site_busy" | "site_hourly";

/** `retryAt`: the time from which the same scan would be admitted, when it can be known. */
export type Admission = { status: "admitted"; slot: string } | { status: Refusal; retryAt?: number };

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Start of the next UTC day. */
export function nextUtcDay(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

/**
 * Admits one scan if every limit allows it. The store keeps the returned state and site starts only for an
 * admitted scan: a refusal changes nothing.
 */
export function admit(state: BudgetState | undefined, now: number, limits: BudgetLimits, applicant: Applicant, slotId: string): { admission: Admission; state: BudgetState; siteStarts: number[] } {
  const day = utcDay(now);
  const today = state?.day === day ? state : undefined;
  const next: BudgetState = { day, usedMs: today?.usedMs ?? 0, platformMs: { ...today?.platformMs }, slots: { ...state?.slots } };
  for (const [id, slot] of Object.entries(next.slots)) if (slot.until <= now) delete next.slots[id];
  const slots = Object.values(next.slots);
  const running = (match: (slot: Slot) => boolean) => slots.filter(match).length;
  const siteStarts = applicant.siteStarts.filter((at) => at > now - HOUR_MS).sort((a, b) => a - b);
  const refuse = (status: Refusal, retryAt?: number) => ({ admission: retryAt === undefined ? { status } : { status, retryAt }, state: next, siteStarts });

  if (applicant.client !== undefined) {
    if (running((slot) => slot.client === applicant.client) >= limits.clientRunning) return refuse("client_busy");
    if (applicant.clientScans >= limits.clientDaily) return refuse("client_daily", nextUtcDay(now));
  }
  if (running((slot) => slot.site === applicant.site) >= limits.siteRunning) return refuse("site_busy");
  // Admitted again once enough of the hour's scans are more than an hour old.
  if (siteStarts.length >= limits.siteHourly) return refuse("site_hourly", siteStarts[siteStarts.length - limits.siteHourly]! + HOUR_MS);

  // A platform may use what is free, except the part of their reserves the other platforms have not used.
  const others = PLATFORMS.filter((platform) => platform !== applicant.platform);
  const keptSlots = others.reduce((sum, platform) => sum + Math.max(0, limits.reserves[platform].running - running((slot) => slot.platform === platform)), 0);
  if (slots.length + 1 + keptSlots > limits.maxRunning) return refuse("busy");
  const keptMs = others.reduce((sum, platform) => sum + Math.max(0, limits.reserves[platform].share * limits.dailyBudgetMs - (next.platformMs?.[platform] ?? 0)), 0);
  if (next.usedMs + limits.reserveMs + keptMs > limits.dailyBudgetMs) return refuse("budget", nextUtcDay(now));

  next.usedMs += limits.reserveMs;
  next.platformMs = { ...next.platformMs, [applicant.platform]: (next.platformMs?.[applicant.platform] ?? 0) + limits.reserveMs };
  next.slots[slotId] = { day, until: now + limits.slotTtlMs, reservedMs: limits.reserveMs, platform: applicant.platform, site: applicant.site, ...(applicant.client === undefined ? {} : { client: applicant.client }) };
  return { admission: { status: "admitted", slot: slotId }, state: next, siteStarts: [...siteStarts, now] };
}

/** Frees the slot and charges the time actually billed instead of its reservation; undefined if unknown. */
export function settle(state: BudgetState | undefined, slotId: string, billedMs: number): BudgetState | undefined {
  const slot = state?.slots[slotId];
  if (!state || !slot) return undefined;
  const slots = { ...state.slots };
  delete slots[slotId];
  // A reservation charged to a previous day stays there: the current day owes nothing back.
  if (slot.day !== state.day) return { ...state, slots };
  const charge = (usedMs: number) => Math.max(0, usedMs - slot.reservedMs + billedMs);
  const platformMs = { ...state.platformMs };
  if (slot.platform) platformMs[slot.platform] = charge(platformMs[slot.platform] ?? 0);
  return { day: state.day, usedMs: charge(state.usedMs), platformMs, slots };
}
