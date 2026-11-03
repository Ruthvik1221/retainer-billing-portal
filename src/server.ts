import { createApp } from "./app.js";
import { TokenService } from "./magicLink.js";
import { StripeProvider } from "./provider.js";
import { MemoryStore } from "./store.js";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

const store = new MemoryStore();
store.clients.set("c_demo", { id: "c_demo", name: "Demo Client", email: "client@example.com" });
store.retainers.set("r_demo", {
  id: "r_demo",
  clientId: "c_demo",
  service: "Monthly SEO retainer",
  amountCents: 150_000,
  status: "active",
  startedAt: Date.now(),
  minimumTermEndsAt: Date.now() + 90 * 24 * 3600_000,
  noticeDays: 30,
  selfPauseAllowed: true,
  maxPauseMonthsPerYear: 2,
  pauseMonthsUsedThisYear: 0,
});

const app = createApp({
  store,
  provider: new StripeProvider(env("STRIPE_SECRET_KEY"), env("STRIPE_WEBHOOK_SECRET")),
  tokens: new TokenService(env("PORTAL_TOKEN_SECRET")),
  baseUrl: process.env.BASE_URL ?? "http://localhost:3000",
  // Demo only: print the link. In production this sends an email.
  sendLink: async (email, url) => console.log(`login link for ${email}: ${url}`),
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`listening on http://localhost:${port}`));
