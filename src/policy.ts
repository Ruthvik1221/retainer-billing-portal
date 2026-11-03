import type { Retainer } from "./types.js";

const DAY = 24 * 60 * 60 * 1000;
const MONTH = 30 * DAY;

export type Decision<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Business rules live in pure functions so they can be tested exhaustively
 * and so the portal, the admin and the webhook handler all agree.
 */
export function pauseDecision(r: Retainer, months: number, now: number): Decision<{ pausedUntil: number }> {
  if (r.status !== "active") return { ok: false, reason: `retainer is ${r.status}` };
  if (!r.selfPauseAllowed) return { ok: false, reason: "this retainer can't be paused from the portal" };
  if (!Number.isInteger(months) || months < 1) return { ok: false, reason: "pause must be a whole number of months" };
  const remaining = r.maxPauseMonthsPerYear - r.pauseMonthsUsedThisYear;
  if (months > remaining) return { ok: false, reason: `only ${Math.max(0, remaining)} pause month(s) left this year` };
  return { ok: true, value: { pausedUntil: now + months * MONTH } };
}

/** Earliest date a cancellation can take effect: max(now + notice, end of minimum term). */
export function cancelDecision(r: Retainer, now: number): Decision<{ cancelAt: number }> {
  if (r.status === "cancelled" || r.status === "cancel_scheduled") return { ok: false, reason: `retainer is already ${r.status}` };
  const afterNotice = now + r.noticeDays * DAY;
  const cancelAt = Math.max(afterNotice, r.minimumTermEndsAt ?? 0);
  return { ok: true, value: { cancelAt } };
}
