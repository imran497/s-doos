import { db } from "../db";

/** Runs a job and records it in the runs log shown on the Settings page. */
export async function logRun<T extends { errors: string[] }>(kind: string, job: () => Promise<T>) {
  const { lastInsertRowid } = db.prepare("INSERT INTO runs (kind) VALUES (?)").run(kind);
  try {
    const result = await job();
    db.prepare("UPDATE runs SET finished_at = datetime('now', 'localtime'), status = ?, message = ? WHERE id = ?").run(
      result.errors.length ? "partial" : "ok",
      result.errors.slice(0, 5).join("\n") || null,
      lastInsertRowid,
    );
    return result;
  } catch (error) {
    db.prepare("UPDATE runs SET finished_at = datetime('now', 'localtime'), status = 'failed', message = ? WHERE id = ?").run(
      (error as Error).message,
      lastInsertRowid,
    );
    throw error;
  }
}
