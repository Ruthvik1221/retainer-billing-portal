import type { BillingEvent } from "./provider.js";
import type { MemoryStore } from "./store.js";

export type WebhookOutcome = "applied" | "duplicate" | "stale" | "unknown_subscription" | "ignored";

/**
 * Apply a verified provider event.
 * - Idempotent: providers retry, so an event id is applied at most once.
 * - Order-safe: webhooks can arrive out of order; a status change older than
 *   the last applied event for that retainer is recorded but not applied.
 * - Payment records are append-only and keyed by invoice id, so a replay can't double-count.
 */
export function applyEvent(store: MemoryStore, e: BillingEvent): WebhookOutcome {
  if (store.processedEvents.has(e.id)) return "duplicate";
  store.processedEvents.add(e.id);
  if (e.type === "ignored") return "ignored";

  const r = e.subscriptionId ? store.retainerBySubscription(e.subscriptionId) : undefined;
  if (!r) return "unknown_subscription";

  if (e.type === "invoice.paid" || e.type === "invoice.payment_failed") {
    if (e.invoiceId && !store.invoices.has(e.invoiceId)) {
      store.invoices.set(e.invoiceId, {
        id: e.invoiceId,
        retainerId: r.id,
        amountCents: e.amountCents ?? 0,
        status: e.type === "invoice.paid" ? "paid" : "failed",
        at: e.created,
      });
    }
  }

  if ((r.lastEventAt ?? 0) > e.created) return "stale";
  r.lastEventAt = e.created;

  switch (e.type) {
    case "invoice.paid":
      if (r.status === "past_due") r.status = "active";
      break;
    case "invoice.payment_failed":
      if (r.status === "active") r.status = "past_due";
      break;
    case "subscription.deleted":
      r.status = "cancelled";
      break;
    case "subscription.updated":
      if (e.status === "past_due" || e.status === "unpaid") r.status = "past_due";
      else if (e.status === "active" && r.status === "past_due") r.status = "active";
      break;
  }
  return "applied";
}
