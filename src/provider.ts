import Stripe from "stripe";

/** A normalized provider event, so the handler doesn't depend on Stripe's types. */
export interface BillingEvent {
  id: string;
  type: "invoice.paid" | "invoice.payment_failed" | "subscription.updated" | "subscription.deleted" | "ignored";
  created: number; // ms
  subscriptionId?: string;
  invoiceId?: string;
  amountCents?: number;
  status?: string;
}

export interface BillingProvider {
  createSubscription(input: { customerId: string; amountCents: number; product: string; idempotencyKey: string }): Promise<{ subscriptionId: string }>;
  pause(subscriptionId: string, resumesAt: number): Promise<void>;
  cancelAt(subscriptionId: string, at: number): Promise<void>;
  /** Verify the signature on a raw webhook body and normalize it. Throws if the signature is bad. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): BillingEvent;
}

export class StripeProvider implements BillingProvider {
  private stripe: Stripe;
  constructor(
    secretKey: string,
    private webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey);
  }

  async createSubscription(input: { customerId: string; amountCents: number; product: string; idempotencyKey: string }) {
    const price = await this.stripe.prices.create(
      { currency: "usd", unit_amount: input.amountCents, recurring: { interval: "month" }, product_data: { name: input.product } },
      { idempotencyKey: `${input.idempotencyKey}:price` },
    );
    const sub = await this.stripe.subscriptions.create(
      { customer: input.customerId, items: [{ price: price.id }], payment_behavior: "default_incomplete" },
      { idempotencyKey: `${input.idempotencyKey}:sub` },
    );
    return { subscriptionId: sub.id };
  }

  async pause(subscriptionId: string, resumesAt: number) {
    await this.stripe.subscriptions.update(subscriptionId, {
      pause_collection: { behavior: "void", resumes_at: Math.floor(resumesAt / 1000) },
    });
  }

  async cancelAt(subscriptionId: string, at: number) {
    await this.stripe.subscriptions.update(subscriptionId, { cancel_at: Math.floor(at / 1000) });
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): BillingEvent {
    if (!signature) throw new Error("missing signature");
    const e = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    const base = { id: e.id, created: e.created * 1000 };
    const obj = e.data.object as unknown as Record<string, unknown>;
    switch (e.type) {
      case "invoice.paid":
      case "invoice.payment_failed": {
        const sub = obj.subscription;
        return {
          ...base,
          type: e.type,
          invoiceId: obj.id as string,
          subscriptionId: typeof sub === "string" ? sub : (sub as { id?: string } | null)?.id,
          amountCents: (obj.amount_paid ?? obj.amount_due) as number,
        };
      }
      case "customer.subscription.updated":
        return { ...base, type: "subscription.updated", subscriptionId: obj.id as string, status: obj.status as string };
      case "customer.subscription.deleted":
        return { ...base, type: "subscription.deleted", subscriptionId: obj.id as string };
      default:
        return { ...base, type: "ignored" };
    }
  }
}
