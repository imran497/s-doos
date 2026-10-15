import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { recordSecurityEvent } from "@/lib/security";
import { unauthorized } from "@/lib/session";

/** Downloads a consistent copy of the whole database (SQLite's online backup, safe while the app runs). */
export async function GET() {
  const denied = await unauthorized();
  if (denied) return denied;
  const file = path.join(os.tmpdir(), `sellerdoos-backup-${process.pid}-${Date.now()}.db`);
  try {
    await db.backup(file);
    const data = await fs.readFile(file);
    recordSecurityEvent("data_exported", "Full database backup downloaded");
    const day = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="sellerdoos-${day}.db"`,
        "Cache-Control": "no-store",
      },
    });
  } finally {
    await fs.rm(file, { force: true });
  }
}
