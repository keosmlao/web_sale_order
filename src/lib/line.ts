import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// LINE Login (OAuth 2.1) config + small signed-token helpers.
//
// Setup (LINE Developers Console → create a "LINE Login" channel under the
// shop's LINE OA provider):
//   LINE_LOGIN_CHANNEL_ID     = Channel ID
//   LINE_LOGIN_CHANNEL_SECRET = Channel secret
// and register <app-origin>/api/auth/line/callback as the Callback URL.

export function lineLoginConfigured(): boolean {
  return Boolean(
    process.env.LINE_LOGIN_CHANNEL_ID && process.env.LINE_LOGIN_CHANNEL_SECRET,
  );
}

export function lineChannelId(): string {
  const v = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!v) throw new Error("LINE_LOGIN_CHANNEL_ID is not set");
  return v;
}

export function lineChannelSecret(): string {
  const v = process.env.LINE_LOGIN_CHANNEL_SECRET;
  if (!v) throw new Error("LINE_LOGIN_CHANNEL_SECRET is not set");
  return v;
}

// --- tiny HMAC-signed tokens (state cookie / pending-link cookie) ----------

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

function hmac(payloadB64: string): string {
  return createHmac("sha256", secret()).update(payloadB64).digest("base64url");
}

export function randomState(): string {
  return randomBytes(16).toString("base64url");
}

export function signPayload(payload: object, ttlSeconds: number): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
  ).toString("base64url");
  return `${body}.${hmac(body)}`;
}

export function verifyPayload<T>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = hmac(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as T & {
      exp?: number;
    };
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}
