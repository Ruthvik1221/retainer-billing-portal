import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { TokenService } from "../src/magicLink.js";
import { FakeProvider, T0, seededStore } from "./helpers.js";

function setup() {
  const store = seededStore();
  const provider = new FakeProvider();
  const sent: string[] = [];
  const app = createApp({
    store,
    provider,
    tokens: new TokenService("s".repeat(40)),
    baseUrl: "https://portal.example",
    now: () => T0,
    sendLink: async (_email, url) => void sent.push(url),
  });
  return { app, store, provider, sent };
}

async function login(app: ReturnType<typeof setup>["app"], sent: string[], email = "owner@acme.example") {
  await request(app).post("/portal/login").send({ email }).expect(202);
  const token = new URL(sent.at(-1)!).searchParams.get("token")!;
  const res = await request(app).post("/portal/session").send({ token }).expect(200);
  return `Bearer ${res.body.session}`;
}

describe("client portal", () => {
  it("logs in by magic link and shows only the client's own retainers", async () => {
    const { app, sent } = setup();
    const auth = await login(app, sent);
    const res = await request(app).get("/portal/retainers").set("authorization", auth).expect(200);
    expect(res.body.map((r: { id: string }) => r.id)).toEqual(["r1"]);
  });

  it("gives the same answer for unknown emails and sends nothing", async () => {
    const { app, sent } = setup();
    const res = await request(app).post("/portal/login").send({ email: "nobody@nowhere.example" }).expect(202);
    expect(res.body.message).toMatch(/If that email is on file/);
    expect(sent).toHaveLength(0);
  });

  it("can't touch another client's retainer (404, not 403)", async () => {
    const { app, sent } = setup();
    const auth = await login(app, sent);
    await request(app).post("/portal/retainers/r2/cancel").set("authorization", auth).expect(404);
  });

  it("pauses through the provider and records the allowance", async () => {
    const { app, sent, provider, store } = setup();
    const auth = await login(app, sent);
    await request(app).post("/portal/retainers/r1/pause").set("authorization", auth).send({ months: 1 }).expect(200);
    expect(provider.calls[0]).toMatch(/^pause sub_1 /);
    expect(store.retainers.get("r1")!.pauseMonthsUsedThisYear).toBe(1);
    await request(app).post("/portal/retainers/r1/pause").set("authorization", auth).send({ months: 1 }).expect(422);
  });

  it("schedules cancellation at the policy date and leaves state alone if the provider fails", async () => {
    const { app, sent, provider, store } = setup();
    const auth = await login(app, sent);
    provider.failNext = true;
    await request(app).post("/portal/retainers/r1/cancel").set("authorization", auth).expect(502);
    expect(store.retainers.get("r1")!.status).toBe("active");
    provider.failNext = false;
    const res = await request(app).post("/portal/retainers/r1/cancel").set("authorization", auth).expect(200);
    expect(res.body.status).toBe("cancel_scheduled");
  });

  it("rejects requests without a session", async () => {
    await request(setup().app).get("/portal/retainers").expect(401);
  });
});

describe("webhook endpoint", () => {
  it("rejects bad signatures and applies good ones once", async () => {
    const { app, store } = setup();
    const body = JSON.stringify({ id: "evt_9", type: "subscription.deleted", created: T0, subscriptionId: "sub_1" });
    await request(app).post("/webhooks/billing").set("content-type", "application/json").set("stripe-signature", "forged").send(body).expect(400);
    const ok = await request(app).post("/webhooks/billing").set("content-type", "application/json").set("stripe-signature", "valid").send(body).expect(200);
    expect(ok.body.outcome).toBe("applied");
    const again = await request(app).post("/webhooks/billing").set("content-type", "application/json").set("stripe-signature", "valid").send(body).expect(200);
    expect(again.body.outcome).toBe("duplicate");
    expect(store.retainers.get("r1")!.status).toBe("cancelled");
  });
});
