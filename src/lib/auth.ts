import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Login for the single owner: a password plus a code from an authenticator app (TOTP), and a signed
// session cookie. Configuration comes from the environment, so nothing secret lives in the database:
//   SELLERDOOS_PASSWORD_HASH  from `npm run auth:setup`
//   SELLERDOOS_TOTP_SECRET    base32, also from auth:setup
//   SESSION_SECRET            random; changing it signs everyone out
// Without them, local development runs without login; production refuses to serve (see authMode()).
// Kept in one module so a hosted identity service (e.g. Cognito) can replace it later.

export const SESSION_COOKIE = "sd_session";
export const SESSION_DAYS = 7;

export type AuthMode = "on" | "off" | "misconfigured";

/** "on" when configured; "off" for local development without config; "misconfigured" in production without it. */
export function authMode(): AuthMode {
  const configured = Boolean(process.env.SELLERDOOS_PASSWORD_HASH && process.env.SELLERDOOS_TOTP_SECRET && process.env.SESSION_SECRET);
  if (configured) return "on";
  return process.env.NODE_ENV === "production" && process.env.SELLERDOOS_ALLOW_NO_LOGIN !== "true" ? "misconfigured" : "off";
}

// ---- Password (scrypt) ----
// Stored as scrypt:N:r:p:salt:hash (base64; no $ so .env files need no escaping). scripts/auth-setup.mjs
// writes the same format.

export function hashPassword(password: string, salt = randomBytes(16)) {
  const [N, r, p] = [16384, 8, 1];
  const hash = scryptSync(password, salt, 32, { N, r, p });
  return `scrypt:${N}:${r}:${p}:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [scheme, N, r, p, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---- Authenticator codes (TOTP, RFC 6238: SHA-1, 6 digits, 30-second steps) ----

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string) {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of clean) bits += BASE32.indexOf(c).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secret: string, at = Date.now(), step = 30) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

/** Accepts the current code and its neighbours (±30 s) for clock drift. */
export function verifyTotp(secret: string, code: string, at = Date.now()) {
  const given = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return false;
  return [-1, 0, 1].some((w) => {
    const expected = totp(secret, at + w * 30_000);
    return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
  });
}

// ---- Session cookie: base64url(JSON) + "." + HMAC-SHA256 ----

const sign = (data: string) => createHmac("sha256", process.env.SESSION_SECRET ?? "").update(data).digest("base64url");

export function createSessionToken(now = Date.now()) {
  const data = Buffer.from(JSON.stringify({ exp: now + SESSION_DAYS * 86_400_000, v: 1 })).toString("base64url");
  return `${data}.${sign(data)}`;
}

/** True for a token signed with the current SESSION_SECRET that hasn't expired. */
export function isValidSessionToken(token: string | undefined, now = Date.now()) {
  if (!token || !process.env.SESSION_SECRET) return false;
  const [data, signature] = token.split(".");
  if (!data || !signature) return false;
  const expected = Buffer.from(sign(data));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(data, "base64url").toString()) as { exp: number };
    return typeof exp === "number" && exp > now;
  } catch {
    return false;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DAYS * 86_400,
};

// ---- Brute-force protection: 5 failures per IP in 15 minutes locks that IP for 15 minutes ----

const failures = new Map<string, number[]>();
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;

export function isLockedOut(ip: string, now = Date.now()) {
  const recent = (failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(ip, recent);
  return recent.length >= MAX_FAILURES;
}

export function recordFailure(ip: string, now = Date.now()) {
  failures.set(ip, [...(failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS), now]);
}

export const clearFailures = (ip: string) => failures.delete(ip);
