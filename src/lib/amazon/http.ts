import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { recordSecurityEvent } from "../security";

// Shared plumbing for Amazon's APIs: Login with Amazon tokens, polite retries, and report downloads.

/** Login with Amazon token endpoints. Amazon Ads uses the regional one; SP-API always uses North America's. */
export const LWA_TOKEN_URLS = {
  na: "https://api.amazon.com/auth/o2/token",
  eu: "https://api.amazon.co.uk/auth/o2/token",
  fe: "https://api.amazon.co.jp/auth/o2/token",
} as const;

/** LWA_TOKEN_URL lets tests point logins at a local mock. */
export const tokenUrl = (region: keyof typeof LWA_TOKEN_URLS = "na") => process.env.LWA_TOKEN_URL ?? LWA_TOKEN_URLS[region];

const tokens = new Map<string, { value: string; expiresAt: number }>();

/** Exchanges a Login with Amazon refresh token for an access token, cached until shortly before it expires. */
export async function lwaAccessToken(clientId: string, clientSecret: string, refreshToken: string, label: string, url = tokenUrl()) {
  const key = `${clientId}|${refreshToken}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !body.access_token) {
    // invalid_grant / invalid_client usually means the token was revoked or the app secret changed.
    if (res.status === 400 || res.status === 401) recordSecurityEvent("login_rejected", `${label}: Amazon refused the saved credentials (${body.error_description ?? res.status}).`);
    throw new Error(`${label} login failed: ${body.error_description ?? res.statusText}`);
  }
  tokens.set(key, { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 });
  return body.access_token;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch() that waits and retries when Amazon throttles (429) or is briefly unavailable (500/503),
 * doubling the wait each time. Honours Retry-After when sent.
 */
export async function fetchWithRetry(url: string, init: RequestInit, { retries = 4, baseDelayMs = 2000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, cache: "no-store" });
    const retryable = res.status === 429 || res.status === 500 || res.status === 503;
    if (!retryable || attempt >= retries) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * 2 ** attempt);
  }
}

/** Downloads a report file as a stream, gunzipping it when compressed. Large reports never sit in memory whole. */
export async function downloadStream(url: string, gzip: boolean) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`Report download failed: ${res.status} ${res.statusText}`);
  const stream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  return gzip ? stream.pipe(createGunzip()) : stream;
}

/** Downloads a (small) report file and returns its text. */
export async function downloadText(url: string, gzip: boolean) {
  const chunks: Buffer[] = [];
  for await (const chunk of await downloadStream(url, gzip)) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  // Most reports are UTF-8, but some flat files (e.g. listings in North America and Europe) come as
  // Windows-1252: decoding those as UTF-8 would garble characters like "é" or "™".
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Date helpers for API requests. */
export const isoDay = (date: string) => `${date}T00:00:00Z`;
export const isoDayEnd = (date: string) => `${date}T23:59:59Z`;
