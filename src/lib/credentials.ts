import { db } from "./db";
import { decrypt, encrypt, isEncrypted } from "./secrets";
import { recordSecurityEvent } from "./security";

// API keys and tokens. Each one comes from an environment variable when set (for people who prefer
// .env.local), otherwise from the local database, where Settings and the "Connect" buttons save them
// encrypted (see secrets.ts). Values never leave this machine and Settings never shows secrets back.

export const CREDENTIALS = {
  seller: ["SPAPI_APP_ID", "SPAPI_CLIENT_ID", "SPAPI_CLIENT_SECRET", "SPAPI_REFRESH_TOKEN", "SPAPI_SELLER_ID", "SPAPI_DRAFT"],
  ads: ["ADS_CLIENT_ID", "ADS_CLIENT_SECRET", "ADS_REFRESH_TOKEN"],
  dataforseo: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],
  rainforest: ["RAINFOREST_API_KEY"],
} as const;

export type CredentialGroup = keyof typeof CREDENTIALS;
export type CredentialName = (typeof CREDENTIALS)[CredentialGroup][number];

const key = (name: CredentialName) => `credential:${name}`;

export function getCredential(name: CredentialName): string | undefined {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key(name)) as { value: string } | undefined;
  if (!row?.value) return undefined;
  if (!isEncrypted(row.value)) {
    // Saved before encryption was added: encrypt it in place.
    setCredential(name, row.value);
    return row.value;
  }
  try {
    return decrypt(row.value);
  } catch {
    recordSecurityEvent("decrypt_failed", `${name} couldn't be decrypted (encryption key changed or data tampered with). Reconnect to replace it.`);
    return undefined;
  }
}

/** True when the value comes from an environment variable (so Settings can't change it). */
export const fromEnvironment = (name: CredentialName) => Boolean(process.env[name]);

export function setCredential(name: CredentialName, value: string) {
  const clean = value.trim();
  if (!clean) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key(name));
    return;
  }
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key(name), encrypt(clean));
}

export function clearCredentials(names: readonly CredentialName[]) {
  for (const name of names) db.prepare("DELETE FROM settings WHERE key = ?").run(key(name));
}

/** Hides all but the last 4 characters, for showing which key is saved. */
export const mask = (value: string | undefined) => (value ? `••••${value.slice(-4)}` : "");
