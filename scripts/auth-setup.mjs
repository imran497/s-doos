// Creates the login secrets for a deployed SellerDoos and writes them to .env.production (git-ignored,
// readable only by you). Nothing secret is printed except the authenticator secret, which you add to an
// authenticator app (Google Authenticator, 1Password, Authy…).
//
//   npm run auth:setup
//
// Re-running replaces the password, authenticator and session secret (everyone is signed out). The
// encryption key is copied from ~/.sellerdoos/master.key so the server can read your stored Amazon tokens.
import { randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const OUT = path.join(process.cwd(), ".env.production");

// One reader for every question (separate readers would lose typed-ahead or piped answers).
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const lines = [];
const waiting = [];
rl.on("line", (line) => (waiting.length ? waiting.shift()(line) : lines.push(line)));
let muted = false;
const write = rl._writeToOutput?.bind(rl);
if (write) rl._writeToOutput = (s) => (muted ? undefined : write(s));

function ask(question, hidden = false) {
  process.stdout.write(question);
  muted = hidden;
  return new Promise((resolve) => {
    const done = (answer) => {
      muted = false;
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    };
    if (lines.length) done(lines.shift());
    else waiting.push(done);
  });
}

// Same format as verifyPassword() in src/lib/auth.ts.
const hashPassword = (password) => {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt:16384:8:1:${salt.toString("base64")}:${hash.toString("base64")}`;
};

const base32 = (buf) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
};

const password = await ask("New SellerDoos password (12+ characters): ", true);
if (password.length < 12) {
  console.error("Use at least 12 characters.");
  rl.close();
  process.exit(1);
}
if ((await ask("Repeat it: ", true)) !== password) {
  console.error("The passwords don't match.");
  rl.close();
  process.exit(1);
}
const domain = (await ask("Address it will run at [sellerdoos.kidbeestoys.com]: ")).trim() || "sellerdoos.kidbeestoys.com";
rl.close();

const keyFile = process.env.SELLERDOOS_KEY_FILE ?? path.join(os.homedir(), ".sellerdoos", "master.key");
const key = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8").trim() : null;
const totp = base32(randomBytes(20));
const values = {
  DOMAIN: domain,
  SELLERDOOS_PASSWORD_HASH: hashPassword(password),
  SELLERDOOS_TOTP_SECRET: totp,
  SESSION_SECRET: randomBytes(32).toString("base64url"),
  SELLERDOOS_KEY: key ?? "",
};
const env = Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
fs.writeFileSync(OUT, env, { mode: 0o600 });

const label = encodeURIComponent(`SellerDoos (${domain})`);
console.log(`
Saved to ${OUT} (only you can read it; it's git-ignored).
${key ? "Your encryption key was copied from " + keyFile + "." : "No encryption key found at " + keyFile + ": the server will need SELLERDOOS_KEY added before it can read stored Amazon tokens."}

Add SellerDoos to your authenticator app:
  • Choose "Enter a setup key" and type:  ${totp.match(/.{1,4}/g).join(" ")}
    (account: SellerDoos, time-based)
  • or open this link on your phone:     otpauth://totp/${label}?secret=${totp}&issuer=SellerDoos

Keep .env.production safe: it's what lets the server sign you in and read your Amazon connection.`);
