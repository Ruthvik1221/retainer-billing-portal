# retainer-billing-portal

Monthly retainer billing for an agency, on Stripe: subscriptions, a self-serve client portal with passwordless login, pause and cancel rules, and webhook handling that stays correct when the provider retries or delivers events out of order.

> Clean-room reference implementation written from scratch to show the pattern. It contains no employer or client code or data. A production version of this kind of system is what I run at work; this repo shows how I'd build it.

## Background

I designed and built the production version of this system at New Paltz Marketing: a Stripe-based client billing platform for the agency's retainers. That code belongs to my employer, so this repository is a clean-room rewrite I wrote from scratch to show the same architecture and decisions publicly. No employer or client code or data is included.

## What's interesting here

| Problem | Approach |
| --- | --- |
| Clients forget passwords; agencies don't want to manage them | **Magic-link login.** HMAC-signed, 15-minute, **single-use** links (nonce hash recorded on first use). Exchanged for a separate session token; a link can't be used as a session. |
| Login can leak which emails are clients | `/portal/login` returns the same 202 message whether or not the email exists. |
| One client probing another's retainer ids | Ownership check returns **404, not 403**, so ids can't be enumerated. |
| "Cancel anytime" vs. contract terms | Pure policy functions: cancellation takes effect at `max(now + notice, end of minimum term)`. Pauses respect a yearly allowance and whole months only. |
| Provider retries the same webhook | Events are applied **at most once** by event id; invoices are keyed by invoice id, so replays can't double-count. |
| Webhooks arrive out of order | Each retainer stores the timestamp of the newest applied event; older status changes are recorded as `stale`, not applied. The invoice record is still kept. |
| Forged webhooks | The route reads the **raw body** before JSON parsing and verifies the Stripe signature. |
| Provider call fails mid-action | Local state is only changed after the provider call succeeds; the client gets a 502 and nothing changes. |

```
client ──email──► /portal/login ──► magic link (email) ──► /portal/session ──► session token
                                                                   │
              /portal/retainers  ◄─────────── Bearer session ──────┘
              /portal/retainers/:id/pause|cancel ──► policy.ts ──► BillingProvider (Stripe) ──► store

Stripe ──► /webhooks/billing (raw body, signature) ──► applyEvent(): dedupe → record invoice → order check → status
```

## Layout

- `src/policy.ts`: pause and cancel rules as pure functions
- `src/magicLink.ts`: signed, expiring, single-use link and session tokens
- `src/webhooks.ts`: idempotent, order-safe event application
- `src/provider.ts`: `BillingProvider` interface and the Stripe implementation (signature verification, `pause_collection`, `cancel_at`, idempotency keys)
- `src/app.ts`: Express routes

## Tests

```bash
npm install
npm test          # 19 tests, no network, Stripe is faked behind the provider interface
npm run typecheck
```

## Run it

```bash
STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... \
PORTAL_TOKEN_SECRET=$(openssl rand -hex 32) npm run dev
curl -X POST localhost:3000/portal/login -H 'content-type: application/json' -d '{"email":"client@example.com"}'
# the demo prints the login link to the console instead of emailing it
```

Storage is in-memory to keep the demo self-contained; the store is a single class to swap for Postgres.

## License

MIT
