import { connection } from "next/server";
import { db } from "@/lib/db";

/** Uptime check for the host: is the app up and the database readable? Public, reveals nothing else. */
export async function GET() {
  await connection();
  try {
    db.prepare("SELECT 1").get();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
