import fs from "node:fs/promises";
import Database from "better-sqlite3";
import { RESTORE_PATH } from "@/lib/db";
import { recordSecurityEvent } from "@/lib/security";
import { unauthorized } from "@/lib/session";

// Replaces all data with an uploaded backup (from Settings → Data, or a copy of data/sellerdoos.db). The
// file is checked, parked next to the database, and swapped in when SellerDoos next starts (src/lib/db.ts).
// In production the app then restarts itself; the host (Render, Docker) starts it again.

const MAX_BYTES = 500 * 1024 * 1024;
const REQUIRED_TABLES = ["products", "settings", "orders", "shipments"];

export async function POST(request: Request) {
  const denied = await unauthorized();
  if (denied) return denied;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return Response.json({ error: "Choose a backup file." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "That file is too large to be a SellerDoos backup." }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 16).toString("latin1") !== "SQLite format 3\u0000") return Response.json({ error: "That isn't a SellerDoos database file." }, { status: 400 });

  const staged = `${RESTORE_PATH}.upload`;
  await fs.writeFile(staged, bytes, { mode: 0o600 });
  try {
    const check = new Database(staged, { readonly: true });
    try {
      const tables = new Set((check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
      const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
      if (missing.length) throw new Error(`It's missing SellerDoos tables (${missing.join(", ")}).`);
      const integrity = (check.pragma("integrity_check", { simple: true }) as string) ?? "";
      if (integrity !== "ok") throw new Error("The file is damaged.");
    } finally {
      check.close();
    }
  } catch (error) {
    await fs.rm(staged, { force: true });
    return Response.json({ error: `Can't restore: ${(error as Error).message}` }, { status: 400 });
  }
  await fs.rename(staged, RESTORE_PATH);
  recordSecurityEvent("data_restored", `Backup "${file.name}" (${Math.round(file.size / 1024)} KB) uploaded; applied on restart`);

  const production = process.env.NODE_ENV === "production";
  if (production) setTimeout(() => process.exit(0), 750);
  return Response.json({
    message: production
      ? "Restoring: SellerDoos is restarting with your data. Reload this page in about a minute."
      : "Backup saved. Restart the dev server (Ctrl+C, then npm run dev:https) to finish restoring.",
  });
}
