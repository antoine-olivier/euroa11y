// Durable Object holding the scan limits: daily budget of browser time, simultaneous scans, and the per-client
// and per-site counts (rules in budget.ts, storage in ledger.ts). Browser Run bills simultaneous browsers
// beyond those included, so the limit on running scans caps the cost that the daily one does not (security
// review, 2026-10-04). The storage calls are synchronous: one admission ends before the next one starts.
import { DurableObject } from "cloudflare:workers";
import type { Admission, BudgetLimits } from "./budget.ts";
import { createLedger, type ScanApplication } from "./ledger.ts";

export class DailyQuota extends DurableObject {
  private readonly ledger = createLedger(this.ctx.storage.kv);

  async admit(limits: BudgetLimits, application: ScanApplication): Promise<Admission> {
    const { admission, alarmAt } = this.ledger.admit(limits, application, Date.now());
    if (alarmAt !== undefined) await this.ctx.storage.setAlarm(alarmAt);
    return admission;
  }

  /** Gives the slot back, charging the browser time actually billed. */
  async release(slot: string, billedMs: number): Promise<void> {
    this.ledger.release(slot, billedMs);
  }

  /** At midnight UTC: deletes the past day's key and counts. */
  override async alarm(): Promise<void> {
    const next = this.ledger.expire(Date.now());
    if (next !== undefined) await this.ctx.storage.setAlarm(next);
  }
}
