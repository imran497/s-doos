import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

// Encryption at rest for API keys and tokens (AES-256-GCM). The key never sits in the database, so a copy
// of the database alone doesn't expose any secrets. On a server it comes from the SELLERDOOS_KEY
// environment variable (base64, 32 bytes); on your computer from a file in your home folder, readable only
// by your user account. SELLERDOOS_KEY_FILE moves that file (tests use a temporary key).

// Loaded this way so the build's file tracer doesn't treat the runtime key path as "any file in the project"
// (which would copy local data and certificates into the server bundle).
const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");

const KEY_FILE = () => process.env.SELLERDOOS_KEY_FILE ?? path.join(os.homedir(), ".sellerdoos", "master.key");
const PREFIX = "enc:v1:";

let cached: Buffer | undefined;

function masterKey() {
  if (cached) return cached;
  if (process.env.SELLERDOOS_KEY) {
    cached = Buffer.from(process.env.SELLERDOOS_KEY.trim(), "base64");
    if (cached.length !== 32) throw new Error("SELLERDOOS_KEY must be 32 bytes, base64-encoded");
    return cached;
  }
  const file = KEY_FILE();
  if (fs.existsSync(file)) {
    cached = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
  } else if (process.env.NODE_ENV === "production" && !process.env.SELLERDOOS_KEY_FILE) {
    // A new random key on a server would make every stored token unreadable: refuse instead.
    throw new Error("Set SELLERDOOS_KEY (the key from your computer's ~/.sellerdoos/master.key) to decrypt stored credentials");
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    cached = randomBytes(32);
    fs.writeFileSync(file, cached.toString("base64"), { mode: 0o600 });
  }
  if (cached.length !== 32) throw new Error(`Encryption key at ${file} is invalid`);
  return cached;
}

export const isEncrypted = (value: string) => value.startsWith(PREFIX);

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

/** Throws if the value was encrypted with a different key or has been tampered with. */
export function decrypt(stored: string) {
  if (!isEncrypted(stored)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export const keyFileLocation = () => (process.env.SELLERDOOS_KEY ? "the SELLERDOOS_KEY environment variable" : KEY_FILE());
