import type { BillingEvent, BillingProvider } from "../src/provider.js";
import { MemoryStore } from "../src/store.js";
import type { Retainer } from "../src/types.js";

export const DAY = 24 * 60 * 60 * 1000;
export const T0 = Date.UTC(2026, 10, 10);

export class FakeProvider implements BillingProvider {
  calls: string[] = [];
  failNext = false;
  async createSubscription() {
    return { subscriptionId: "sub_fake" };
  }
  async pause(id: string, resumesAt: number) {
    if (this.failNext) throw new Error("provider down");
    this.calls.push(`pause ${id} ${resumesAt}`);
  }
  async cancelAt(id: string, at: number) {
    if (this.failNext) throw new Error("provider down");
    this.calls.push(`cancel ${id} ${at}`);
  }
  /** Test "signature" is the literal string "valid"; the body is a JSON BillingEvent. */
  parseWebhook(raw: Buffer, sig: string | undefined): BillingEvent {
    if (sig !== "valid") throw new Error("bad signature");
    return JSON.parse(raw.toString("utf8"));
  }
}

export function retainer(over: Partial<Retainer> = {}): Retainer {
  return {
    id: "r1",
    clientId: "c1",
    service: "SEO retainer",
    amountCents: 150_000,
    status: "active",
    providerSubscriptionId: "sub_1",
    startedAt: T0,
    noticeDays: 30,
    selfPauseAllowed: true,
    maxPauseMonthsPerYear: 2,
    pauseMonthsUsedThisYear: 0,
    ...over,
  };
}

export function seededStore() {
  const s = new MemoryStore();
  s.clients.set("c1", { id: "c1", name: "Acme", email: "owner@acme.example" });
  s.clients.set("c2", { id: "c2", name: "Other", email: "boss@other.example" });
  s.retainers.set("r1", retainer());
  s.retainers.set("r2", retainer({ id: "r2", clientId: "c2", providerSubscriptionId: "sub_2" }));
  return s;
}
