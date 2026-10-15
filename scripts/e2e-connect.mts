// End-to-end test of "Connect with Amazon" against the running app and scripts/mock-amazon.mjs.
// Needs a production build first:   npm run build && npm run test:connect
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const MOCK = 4011;
const APP = 3124;
const app = `http://localhost:${APP}`;
const dbFile = path.join(os.tmpdir(), `sellerdoos-connect-${Date.now()}.db`);
const keyFile = path.join(os.tmpdir(), `sellerdoos-connect-${Date.now()}.key`);
const env = {
  ...process.env,
  DATABASE_PATH: dbFile,
  SELLERDOOS_KEY_FILE: keyFile,
  DISABLE_SCHEDULER: "true",
  AMAZON_AUTH_BASE: `http://localhost:${MOCK}`,
  LWA_TOKEN_URL: `http://localhost:${MOCK}/auth/o2/token`,
  SPAPI_ENDPOINT: `http://localhost:${MOCK}`,
  ADS_ENDPOINT: `http://localhost:${MOCK}`,
  REPORT_POLL_MS: "100",
  // Production mode requires login; this test is about connecting, so run without it (test:auth covers login).
  SELLERDOOS_ALLOW_NO_LOGIN: "true",
  // Next.js loads .env.production in production mode; values set here win, so your real login and key stay out.
  SELLERDOOS_PASSWORD_HASH: "",
  SELLERDOOS_TOTP_SECRET: "",
  SESSION_SECRET: "",
  SELLERDOOS_KEY: "",
  MOCK_QUIET: process.env.VERBOSE ? "" : "1",
};
// Credentials must come from the database (Settings / Connect), never from the environment here.
for (const k of ["SPAPI_APP_ID", "SPAPI_CLIENT_ID", "SPAPI_CLIENT_SECRET", "SPAPI_REFRESH_TOKEN", "ADS_CLIENT_ID", "ADS_CLIENT_SECRET", "ADS_REFRESH_TOKEN"]) delete env[k];

if (!fs.existsSync(path.join(import.meta.dirname, "..", ".next", "BUILD_ID"))) {
  console.error("Run `npm run build` first.");
  process.exit(1);
}

const root = path.join(import.meta.dirname, "..");
const mock = spawn(process.execPath, [path.join(import.meta.dirname, "mock-amazon.mjs"), String(MOCK)], { stdio: "inherit", env });
const server = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(APP)], { cwd: root, env, stdio: "ignore", detached: true });

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok ? "" : `  →  ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
};

const get = (url: string, cookie?: string) => fetch(url, { redirect: "manual", headers: cookie ? { cookie } : {} });

try {
  // Ready once the health check answers (it also means the database schema exists).
  for (let i = 0; i < 120; i++) {
    const up = await fetch(`${app}/api/health`).catch(() => null);
    if (up?.ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  const Database = createRequire(import.meta.url)("better-sqlite3");
  const db = new Database(dbFile);
  Object.assign(process.env, { SELLERDOOS_KEY_FILE: keyFile });
  const { decrypt } = await import("../src/lib/secrets.ts");
  const raw = (key: string) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  const setting = (key: string) => {
    const v = raw(key);
    return v ? decrypt(v) : v;
  };
  const save = (key: string, value: string) => db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);

  console.log("Before app keys are saved");
  const early = await get(`${app}/api/amazon/connect/seller?marketplace=US`);
  check("Connect explains that app keys are missing", (early.headers.get("location") ?? "").includes("error=Save+your+app+keys"), early.headers.get("location"));

  // Plaintext values, as saved by an older SellerDoos: they must be read and then encrypted in place.
  save("credential:SPAPI_APP_ID", "amzn1.sp.solution.mock");
  save("credential:SPAPI_CLIENT_ID", "test-client");
  save("credential:SPAPI_CLIENT_SECRET", "test-secret");
  save("credential:ADS_CLIENT_ID", "test-client");
  save("credential:ADS_CLIENT_SECRET", "test-secret");

  for (const kind of ["seller", "ads"] as const) {
    console.log(`Connect ${kind === "seller" ? "Seller Central" : "Amazon Ads"}`);
    const start = await get(`${app}/api/amazon/connect/${kind}?marketplace=US`);
    const consent = new URL(start.headers.get("location") ?? "about:blank");
    const cookie = (start.headers.get("set-cookie") ?? "").split(";")[0];
    check("redirects to Amazon's consent page", consent.pathname === (kind === "seller" ? "/apps/authorize/consent" : "/ap/oa"), consent.toString());
    check("sends the registered redirect URI", consent.searchParams.get("redirect_uri") === `${app}/api/amazon/callback/${kind}`);
    if (kind === "seller") check("Draft app gets version=beta", consent.searchParams.get("version") === "beta");
    else check("asks for the advertising scope", consent.searchParams.get("scope") === "advertising::campaign_management");
    check("state cookie set", cookie.startsWith(`sd_oauth_${kind}=`), cookie);

    // A forged callback (wrong state) must be refused.
    const back = new URL((await get(consent.toString())).headers.get("location") ?? "about:blank");
    const forged = new URL(back);
    forged.searchParams.set("state", "not-the-one");
    const forgedResult = await get(forged.toString(), cookie);
    check("forged callback refused", (forgedResult.headers.get("location") ?? "").includes("error="), forgedResult.headers.get("location"));

    const done = await get(back.toString(), cookie);
    check("callback lands on Settings as connected", (done.headers.get("location") ?? "").endsWith(`/settings?connected=${kind}`), done.headers.get("location"));
    check(
      "refresh token saved",
      setting(`credential:${kind === "seller" ? "SPAPI" : "ADS"}_REFRESH_TOKEN`) === (kind === "seller" ? "Atzr|seller-refresh" : "Atzr|ads-refresh"),
    );
    if (kind === "seller") check("seller id saved", setting("credential:SPAPI_SELLER_ID") === "A1MOCKSELLER");
    check("refresh token stored encrypted, not in plain text", (raw(`credential:${kind === "seller" ? "SPAPI" : "ADS"}_REFRESH_TOKEN`) ?? "").startsWith("enc:v1:"));
  }

  console.log("Encryption and security log");
  check("old plaintext app keys were encrypted in place", (raw("credential:SPAPI_CLIENT_SECRET") ?? "").startsWith("enc:v1:") && setting("credential:SPAPI_CLIENT_SECRET") === "test-secret");
  const forgedLogged = db.prepare("SELECT COUNT(*) n FROM security_events WHERE kind = 'forged_callback'").get() as { n: number };
  check("forged callbacks recorded in the Security log", forgedLogged.n >= 1, forgedLogged);
  check("encryption key file is private (mode 600)", (fs.statSync(keyFile).mode & 0o777) === 0o600, (fs.statSync(keyFile).mode & 0o777).toString(8));

  console.log("Settings page");
  const html = await (await fetch(`${app}/settings`)).text();
  check("both cards show Connected", (html.match(/>Connected</g) ?? []).length >= 2);
  check("secrets are not shown", !html.includes("test-secret") && !html.includes("seller-refresh"));
  check("unreviewed security events flagged", html.includes("security event"));

  console.log("Sync uses the saved tokens");
  db.prepare("INSERT INTO products (asin, marketplace) VALUES ('B0GZ8LVLGR', 'US')").run();
  db.close();
  Object.assign(process.env, env);
  const { syncAmazon } = await import("../src/lib/jobs/index.ts");
  const result = await syncAmazon({ waitMs: 3_000 });
  check("sync with connected accounts ran without errors", result.errors.length === 0, result.errors);
  const { db: appDb } = await import("../src/lib/db.ts");
  check("inventory pulled with the Seller Central token", (appDb.prepare("SELECT COUNT(*) n FROM inventory_snapshots").get() as { n: number }).n > 0);
  check("Ads profile found with the Ads token", (appDb.prepare("SELECT value FROM settings WHERE key = 'adsProfile:US'").get() as { value: string } | undefined)?.value === "111");
} catch (error) {
  console.error(error);
  failures++;
} finally {
  try {
    if (server.pid) process.kill(-server.pid, "SIGTERM"); // next start runs the server in a child process
  } catch {
    server.kill();
  }
  mock.kill();
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`, keyFile]) fs.rmSync(f, { force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
