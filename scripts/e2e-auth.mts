// End-to-end test of the login gate against a production build, signing in with a real (headless) Chrome.
// Needs a production build first:   npm run build && npm run test:auth
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const APP = 3125;
const BARE = 3126;
const app = `http://localhost:${APP}`;
const root = path.join(import.meta.dirname, "..");
const stamp = Date.now();
const dbFile = path.join(os.tmpdir(), `sellerdoos-auth-${stamp}.db`);
const PASSWORD = "correct horse battery staple";
const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (!fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
  console.error("Run `npm run build` first.");
  process.exit(1);
}

const { hashPassword, totp, isLockedOut, recordFailure, verifyTotp, createSessionToken } = await import("../src/lib/auth.ts");
const base = { ...process.env, DATABASE_PATH: dbFile, SELLERDOOS_KEY_FILE: `${dbFile}.key`, DISABLE_SCHEDULER: "true" };
delete base.SELLERDOOS_ALLOW_NO_LOGIN;
const authEnv = { SELLERDOOS_PASSWORD_HASH: hashPassword(PASSWORD), SELLERDOOS_TOTP_SECRET: TOTP_SECRET, SESSION_SECRET: "e2e-session-secret" };
const start = (port: number, env: NodeJS.ProcessEnv) =>
  spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], { cwd: root, env, stdio: "ignore" });

const children: ChildProcess[] = [start(APP, { ...base, ...authEnv }), start(BARE, base)];
let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok ? "" : `  →  ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
};
const get = (url: string, init: RequestInit = {}) => fetch(url, { redirect: "manual", ...init });
const waitFor = async (url: string) => {
  for (let i = 0; i < 60; i++) {
    if (await fetch(url).then(() => true, () => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
};

/** Minimal Chrome DevTools Protocol client: enough to load a page, run script and read cookies. */
async function browser() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sd-chrome-"));
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
  children.push(proc);
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 40 && !target; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const list = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json(), () => [])) as { type: string; webSocketDebuggerUrl: string }[];
    target = list.find((t) => t.type === "page");
  }
  if (!target) throw new Error("Chrome didn't start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map<number, (v: never) => void>();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(String(e.data)) as { id?: number; result?: unknown };
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)!(msg.result as never);
  });
  type CdpResult = { result?: { value?: unknown }; cookies?: unknown };
  const send = (method: string, params: object = {}) =>
    new Promise<CdpResult>((resolve) => {
      pending.set(++id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression: string) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
  const until = async (expression: string, ms = 10_000) => {
    for (let t = 0; t < ms; t += 200) {
      if (await evaluate(expression)) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };
  return {
    goto: async (url: string) => {
      await send("Page.navigate", { url });
      await until("document.readyState === 'complete'");
      await new Promise((r) => setTimeout(r, 800)); // let React hydrate the form
    },
    evaluate,
    until,
    cookies: async () => (await send("Network.getCookies", { urls: [app] })).cookies as { name: string; httpOnly: boolean; secure: boolean }[],
    close: () => ws.close(),
  };
}

const signIn = (password: string, code: string) => `(() => {
  const set = (name, value) => { const el = document.querySelector('input[name=' + name + ']'); el.value = value; };
  set('password', ${JSON.stringify(password)}); set('code', ${JSON.stringify(code)});
  document.querySelector('form').requestSubmit();
  return true;
})()`;

try {
  await Promise.all([waitFor(`${app}/api/health`), waitFor(`http://localhost:${BARE}/api/health`)]);

  console.log("Without a session");
  const home = await get(`${app}/summary`);
  check("pages redirect to the login page", home.status === 307 && home.headers.get("location")?.endsWith("/login?next=%2Fsummary") === true, [home.status, home.headers.get("location")]);
  check("API routes refuse (401)", (await get(`${app}/api/amazon/connect/seller`)).status === 401);
  check("server actions refuse (401)", (await get(`${app}/`, { method: "POST", headers: { "Next-Action": "anything" } })).status === 401);
  check("privacy notice is public", (await get(`${app}/privacy`)).status === 200);
  check("health check is public", (await get(`${app}/api/health`)).status === 200);
  check("a forged cookie is refused", (await get(`${app}/summary`, { headers: { cookie: "sd_session=e30.forged" } })).status === 307);

  console.log("Security headers");
  const login = await get(`${app}/login`);
  check("HSTS, no framing, no sniffing", Boolean(login.headers.get("strict-transport-security")) && login.headers.get("x-frame-options") === "DENY" && login.headers.get("x-content-type-options") === "nosniff");
  check("app pages aren't indexed, privacy is", login.headers.get("x-robots-tag")?.includes("noindex") === true && !(await get(`${app}/privacy`)).headers.get("x-robots-tag"));

  console.log("Production without login configured");
  check("refuses to serve (503)", (await get(`http://localhost:${BARE}/summary`)).status === 503);
  check("still shows the privacy notice", (await get(`http://localhost:${BARE}/privacy`)).status === 200);

  console.log("Signing in (headless Chrome)");
  const b = await browser();
  await b.goto(`${app}/login?next=%2Fshipments`);
  await b.evaluate(signIn(PASSWORD, "000000"));
  check("a wrong code is rejected", await b.until("document.body.innerText.includes(\"isn't right\")"));
  const db = new (createRequire(import.meta.url)("better-sqlite3"))(dbFile);
  check("the failure is in the security log", Boolean(db.prepare("SELECT 1 FROM security_events WHERE kind = 'signin_failed'").get()));
  await b.goto(`${app}/login?next=%2Fshipments`);
  await b.evaluate(signIn(PASSWORD, totp(TOTP_SECRET)));
  check("password + authenticator code signs in and returns to the page", await b.until("location.pathname === '/shipments'"), await b.evaluate("location.href"));
  const session = (await b.cookies()).find((c) => c.name === "sd_session");
  check("session cookie is httpOnly and Secure", session?.httpOnly === true && session?.secure === true, session);
  check("the app loads once signed in", await b.until("document.body.innerText.includes('Shipments')"));
  await b.evaluate("Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('Sign out')).click(), true");
  check("sign out returns to the login page", await b.until("location.pathname === '/login'"));
  b.close();
  db.close();

  console.log("Building blocks");
  check("authenticator codes accept ±30 s of clock drift, not more", verifyTotp(TOTP_SECRET, totp(TOTP_SECRET, Date.now() - 30_000)) && !verifyTotp(TOTP_SECRET, totp(TOTP_SECRET, Date.now() - 120_000)));
  const ip = "203.0.113.9";
  for (let i = 0; i < 5; i++) recordFailure(ip);
  check("5 failures lock that address", isLockedOut(ip) && !isLockedOut("203.0.113.10"));
  process.env.SESSION_SECRET = "e2e-session-secret";
  const valid = await get(`${app}/summary`, { headers: { cookie: `sd_session=${createSessionToken()}` } });
  check("a session signed with the server's secret is accepted", valid.status === 200, valid.status);
  process.env.SESSION_SECRET = "a-different-secret";
  check("changing SESSION_SECRET signs everyone out", (await get(`${app}/summary`, { headers: { cookie: `sd_session=${createSessionToken()}` } })).status === 307);

  console.log("Backup and restore");
  process.env.SESSION_SECRET = "e2e-session-secret";
  const cookie = `sd_session=${createSessionToken()}`;
  check("backup download needs a session", (await get(`${app}/api/data/backup`)).status === 401);
  const backup = await get(`${app}/api/data/backup`, { headers: { cookie } });
  const bytes = Buffer.from(await backup.arrayBuffer());
  check("backup is a complete SQLite file", backup.status === 200 && bytes.subarray(0, 15).toString() === "SQLite format 3", backup.status);
  const upload = (data: Buffer, name: string, withCookie = true) => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(data)], name));
    return get(`${app}/api/data/restore`, { method: "POST", body: form, headers: withCookie ? { cookie } : {} });
  };
  check("restore needs a session", (await upload(bytes, "x.db", false)).status === 401);
  check("a file that isn't a database is refused", (await upload(Buffer.from("hello"), "notes.txt")).status === 400);
  const marker = new (createRequire(import.meta.url)("better-sqlite3"))(dbFile);
  marker.prepare("INSERT INTO settings (key, value) VALUES ('e2e:marker', 'after-backup')").run();
  marker.close();
  const restored = await upload(bytes, "sellerdoos-backup.db");
  check("a valid backup is accepted", restored.status === 200, await restored.clone().text());
  await new Promise((r) => setTimeout(r, 2000));
  check("the app restarts itself to apply it", children[0].exitCode !== null, children[0].exitCode);
  children[0] = start(APP, { ...base, ...authEnv });
  await waitFor(`${app}/api/health`);
  const after = new (createRequire(import.meta.url)("better-sqlite3"))(dbFile);
  check("after restart the data is the backup's (later change gone)", !after.prepare("SELECT 1 FROM settings WHERE key = 'e2e:marker'").get());
  after.close();
  check("restore file was consumed", !fs.existsSync(`${dbFile}.restore`));
} catch (error) {
  console.error(error);
  failures++;
} finally {
  for (const c of children) c.kill();
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`, `${dbFile}.key`]) fs.rmSync(f, { force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
