import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Passwordless client portal login.
 *
 * Link token  = base64url(payload) "." HMAC(payload)   payload = {sub, nonce, exp}
 * - Signed, so it can't be forged or have its expiry edited.
 * - Short-lived (default 15 minutes).
 * - Single use: the nonce's hash is recorded on first use and rejected after.
 * Exchanging a link returns a session token with the same structure and a longer expiry.
 */
export class TokenService {
  private usedNonces = new Map<string, number>(); // sha256(nonce) -> expiry

  constructor(
    private secret: string,
    private now: () => number = Date.now,
  ) {
    if (secret.length < 32) throw new Error("token secret must be at least 32 characters");
  }

  private sign(data: string) {
    return createHmac("sha256", this.secret).update(data).digest("base64url");
  }

  private issue(kind: "link" | "session", sub: string, ttlMs: number) {
    const payload = Buffer.from(JSON.stringify({ k: kind, sub, nonce: randomBytes(16).toString("base64url"), exp: this.now() + ttlMs })).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  private read(token: string, kind: "link" | "session"): { sub: string; nonce: string; exp: number } | null {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    let body: { k: string; sub: string; nonce: string; exp: number };
    try {
      body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (body.k !== kind || body.exp <= this.now()) return null;
    return body;
  }

  issueLink(clientId: string, ttlMs = 15 * 60_000) {
    return this.issue("link", clientId, ttlMs);
  }

  /** Exchange a magic link for a session. Returns null if invalid, expired or already used. */
  redeemLink(token: string, sessionTtlMs = 8 * 60 * 60_000): { clientId: string; session: string } | null {
    const body = this.read(token, "link");
    if (!body) return null;
    const key = createHash("sha256").update(body.nonce).digest("hex");
    this.prune();
    if (this.usedNonces.has(key)) return null;
    this.usedNonces.set(key, body.exp);
    return { clientId: body.sub, session: this.issue("session", body.sub, sessionTtlMs) };
  }

  verifySession(token: string): string | null {
    return this.read(token, "session")?.sub ?? null;
  }

  private prune() {
    const t = this.now();
    for (const [k, exp] of this.usedNonces) if (exp <= t) this.usedNonces.delete(k);
  }
}
