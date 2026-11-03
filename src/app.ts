import express from "express";
import { z } from "zod";
import { TokenService } from "./magicLink.js";
import { cancelDecision, pauseDecision } from "./policy.js";
import type { BillingProvider } from "./provider.js";
import type { MemoryStore } from "./store.js";
import { applyEvent } from "./webhooks.js";

export interface Deps {
  store: MemoryStore;
  provider: BillingProvider;
  tokens: TokenService;
  baseUrl: string;
  now?: () => number;
  /** Delivers the magic link (email in production). Never returned to the caller. */
  sendLink: (email: string, url: string) => Promise<void>;
}

export function createApp(d: Deps) {
  const now = d.now ?? Date.now;
  const app = express();

  // Webhooks need the exact raw bytes for signature verification, so this route is registered before express.json().
  app.post("/webhooks/billing", express.raw({ type: "application/json" }), (req, res) => {
    let event;
    try {
      event = d.provider.parseWebhook(req.body as Buffer, req.header("stripe-signature"));
    } catch {
      return void res.status(400).json({ error: "invalid signature" });
    }
    res.json({ outcome: applyEvent(d.store, event) });
  });

  app.use(express.json());

  // Request a login link. Same response whether or not the email exists, so it can't be used to discover clients.
  app.post("/portal/login", async (req, res) => {
    const body = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "valid email required" });
    const client = [...d.store.clients.values()].find((c) => c.email.toLowerCase() === body.data.email.toLowerCase());
    if (client) await d.sendLink(client.email, `${d.baseUrl}/portal/session?token=${encodeURIComponent(d.tokens.issueLink(client.id))}`);
    res.status(202).json({ message: "If that email is on file, a login link is on its way." });
  });

  app.post("/portal/session", (req, res) => {
    const token = z.object({ token: z.string() }).safeParse(req.body);
    const redeemed = token.success ? d.tokens.redeemLink(token.data.token) : null;
    if (!redeemed) return void res.status(401).json({ error: "link is invalid, expired or already used" });
    res.json({ session: redeemed.session });
  });

  const auth: express.RequestHandler = (req, res, next) => {
    const clientId = d.tokens.verifySession((req.header("authorization") ?? "").replace(/^Bearer /, ""));
    if (!clientId) return void res.status(401).json({ error: "sign in again" });
    res.locals.clientId = clientId;
    next();
  };

  app.get("/portal/retainers", auth, (_req, res) => {
    res.json(d.store.retainersFor(res.locals.clientId));
  });

  // A client can only act on their own retainers; anything else is a 404, not a 403, so ids can't be probed.
  const own = (req: express.Request, res: express.Response) => {
    const r = d.store.retainers.get(req.params.id);
    if (!r || r.clientId !== res.locals.clientId) {
      res.status(404).json({ error: "not found" });
      return undefined;
    }
    return r;
  };

  app.post("/portal/retainers/:id/pause", auth, async (req, res, next) => {
    try {
      const r = own(req, res);
      if (!r) return;
      const months = Number(req.body?.months);
      const decision = pauseDecision(r, months, now());
      if (!decision.ok) return void res.status(422).json({ error: decision.reason });
      if (r.providerSubscriptionId) await d.provider.pause(r.providerSubscriptionId, decision.value.pausedUntil);
      r.status = "paused";
      r.pausedUntil = decision.value.pausedUntil;
      r.pauseMonthsUsedThisYear += months;
      res.json(r);
    } catch (e) {
      next(e);
    }
  });

  app.post("/portal/retainers/:id/cancel", auth, async (req, res, next) => {
    try {
      const r = own(req, res);
      if (!r) return;
      const decision = cancelDecision(r, now());
      if (!decision.ok) return void res.status(422).json({ error: decision.reason });
      if (r.providerSubscriptionId) await d.provider.cancelAt(r.providerSubscriptionId, decision.value.cancelAt);
      r.status = "cancel_scheduled";
      r.cancelAt = decision.value.cancelAt;
      res.json({ ...r, message: `Cancellation takes effect ${new Date(decision.value.cancelAt).toISOString().slice(0, 10)}.` });
    } catch (e) {
      next(e);
    }
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(502).json({ error: "billing provider error, nothing was changed" });
  });

  return app;
}

