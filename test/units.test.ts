import { describe, expect, it } from "vitest";
import { TokenService } from "../src/magicLink.js";
import { cancelDecision, pauseDecision } from "../src/policy.js";
import { applyEvent } from "../src/webhooks.js";
import { DAY, T0, retainer, seededStore } from "./helpers.js";

const SECRET = "x".repeat(40);

describe("pause policy", () => {
  it("allows a pause within the yearly allowance", () => {
    expect(pauseDecision(retainer(), 2, T0)).toEqual({ ok: true, value: { pausedUntil: T0 + 60 * DAY } });
  });
  it("refuses beyond the allowance, fractional months, disabled pauses, and non-active retainers", () => {
    expect(pauseDecision(retainer({ pauseMonthsUsedThisYear: 1 }), 2, T0)).toMatchObject({ ok: false, reason: /1 pause month/ });
    expect(pauseDecision(retainer(), 1.5, T0).ok).toBe(false);
    expect(pauseDecision(retainer({ selfPauseAllowed: false }), 1, T0).ok).toBe(false);
    expect(pauseDecision(retainer({ status: "past_due" }), 1, T0).ok).toBe(false);
  });
});

describe("cancel policy", () => {
  it("applies the notice period", () => {
    expect(cancelDecision(retainer(), T0)).toEqual({ ok: true, value: { cancelAt: T0 + 30 * DAY } });
  });
  it("never ends before the minimum term", () => {
    const end = T0 + 90 * DAY;
    expect(cancelDecision(retainer({ minimumTermEndsAt: end }), T0)).toEqual({ ok: true, value: { cancelAt: end } });
  });
  it("refuses a second cancellation", () => {
    expect(cancelDecision(retainer({ status: "cancel_scheduled" }), T0).ok).toBe(false);
  });
});

describe("magic links", () => {
  it("are single-use and expire", () => {
    let now = T0;
    const t = new TokenService(SECRET, () => now);
    const link = t.issueLink("c1");
    const first = t.redeemLink(link);
    expect(first?.clientId).toBe("c1");
    expect(t.redeemLink(link)).toBeNull(); // replay
    const late = t.issueLink("c1");
    now += 16 * 60_000;
    expect(t.redeemLink(late)).toBeNull(); // expired
  });

  it("reject tampering, wrong secret, and a link used as a session", () => {
    const t = new TokenService(SECRET);
    const link = t.issueLink("c1");
    const [payload, sig] = link.split(".");
    const forged = Buffer.from(JSON.stringify({ k: "link", sub: "c2", nonce: "n", exp: Date.now() + 1e6 })).toString("base64url");
    expect(t.redeemLink(`${forged}.${sig}`)).toBeNull();
    expect(new TokenService("y".repeat(40)).redeemLink(link)).toBeNull();
    expect(t.verifySession(link)).toBeNull();
    expect(payload).toBeTruthy();
  });

  it("refuses a short secret", () => {
    expect(() => new TokenService("short")).toThrow();
  });
});

describe("webhooks", () => {
  it("are idempotent and record each invoice once", () => {
    const s = seededStore();
    const e = { id: "evt_1", type: "invoice.paid" as const, created: T0, subscriptionId: "sub_1", invoiceId: "in_1", amountCents: 150_000 };
    expect(applyEvent(s, e)).toBe("applied");
    expect(applyEvent(s, e)).toBe("duplicate");
    expect(s.invoices.size).toBe(1);
  });

  it("move a retainer to past_due on failure and back on payment", () => {
    const s = seededStore();
    applyEvent(s, { id: "e1", type: "invoice.payment_failed", created: T0, subscriptionId: "sub_1", invoiceId: "in_1", amountCents: 150_000 });
    expect(s.retainers.get("r1")!.status).toBe("past_due");
    applyEvent(s, { id: "e2", type: "invoice.paid", created: T0 + 1000, subscriptionId: "sub_1", invoiceId: "in_2", amountCents: 150_000 });
    expect(s.retainers.get("r1")!.status).toBe("active");
  });

  it("ignore an older event that arrives late, but still record its invoice", () => {
    const s = seededStore();
    applyEvent(s, { id: "e_new", type: "invoice.paid", created: T0 + 5000, subscriptionId: "sub_1", invoiceId: "in_new", amountCents: 1 });
    expect(applyEvent(s, { id: "e_old", type: "invoice.payment_failed", created: T0, subscriptionId: "sub_1", invoiceId: "in_old", amountCents: 1 })).toBe("stale");
    expect(s.retainers.get("r1")!.status).toBe("active");
    expect(s.invoices.get("in_old")?.status).toBe("failed");
  });

  it("report unknown subscriptions instead of guessing", () => {
    expect(applyEvent(seededStore(), { id: "e", type: "subscription.deleted", created: T0, subscriptionId: "sub_nope" })).toBe("unknown_subscription");
  });
});
