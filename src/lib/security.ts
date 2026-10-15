import { db } from "./db";

// Security event log. Anything that might mean a leaked or revoked credential, or someone probing the
// app, is recorded here and surfaced in Settings, so it can be handled within 24 hours as the incident
// response plan (docs/incident-response-plan.md) requires.

export type SecurityEventKind =
  | "login_rejected" // Amazon refused a refresh token or client credentials
  | "access_denied" // an API answered 401/403
  | "forged_callback" // a Connect callback arrived with the wrong state
  | "decrypt_failed" // a stored secret couldn't be decrypted (wrong key or tampering)
  | "disconnected" // a connection was removed in Settings
  | "signin_failed" // a wrong password or authenticator code on the SellerDoos login page
  | "signin_locked" // too many wrong attempts: logins from that address paused
  | "data_exported" // a full database backup was downloaded
  | "data_restored"; // a database backup was uploaded to replace the current data

export function recordSecurityEvent(kind: SecurityEventKind, detail: string) {
  try {
    // Don't flood the log: one entry per kind and detail per hour.
    const recent = db
      .prepare("SELECT 1 FROM security_events WHERE kind = ? AND detail = ? AND at > datetime('now', 'localtime', '-1 hour')")
      .get(kind, detail.slice(0, 500));
    if (!recent) db.prepare("INSERT INTO security_events (kind, detail) VALUES (?, ?)").run(kind, detail.slice(0, 500));
  } catch {
    // Logging must never break the request that triggered it.
  }
  console.warn(`[SellerDoos security] ${kind}: ${detail}`);
}

export const securityEvents = (limit = 20) =>
  db.prepare("SELECT * FROM security_events ORDER BY id DESC LIMIT ?").all(limit) as {
    id: number;
    at: string;
    kind: SecurityEventKind;
    detail: string;
    acknowledged: number;
  }[];

export const unacknowledgedCount = () =>
  (db.prepare("SELECT COUNT(*) n FROM security_events WHERE acknowledged = 0 AND kind != 'disconnected'").get() as { n: number }).n;

export function acknowledgeSecurityEvents() {
  db.prepare("UPDATE security_events SET acknowledged = 1 WHERE acknowledged = 0").run();
}
