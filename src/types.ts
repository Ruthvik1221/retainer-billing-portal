/** All money is integer cents. All times are epoch milliseconds (UTC). */
export type Cents = number;

export interface Client {
  id: string;
  name: string;
  email: string;
  providerCustomerId?: string;
}

export type RetainerStatus = "active" | "paused" | "cancel_scheduled" | "cancelled" | "past_due";

export interface Retainer {
  id: string;
  clientId: string;
  service: string;
  amountCents: Cents;
  status: RetainerStatus;
  providerSubscriptionId?: string;
  startedAt: number;
  /** Client can't cancel effective before this date (e.g. a 3-month minimum). */
  minimumTermEndsAt?: number;
  /** Days of notice required before a cancellation takes effect. */
  noticeDays: number;
  selfPauseAllowed: boolean;
  maxPauseMonthsPerYear: number;
  pauseMonthsUsedThisYear: number;
  pausedUntil?: number;
  cancelAt?: number;
  /** Timestamp of the newest provider event applied, to ignore out-of-order webhooks. */
  lastEventAt?: number;
}

export interface Invoice {
  id: string;
  retainerId: string;
  amountCents: Cents;
  status: "paid" | "failed";
  at: number;
}
