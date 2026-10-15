import { db } from "./db";

// Tunable settings live in the database; secrets (API keys) stay in .env.local.
const defaults = {
  /** Hour of the day (server local time) after which the daily rank check runs. */
  scheduleHour: 6,
  /**
   * How many Amazon search result pages (~48 results each) to scan per keyword. With Rainforest each
   * page is one request; DataForSEO charges per 100 results, so 2 pages (top 100) is one charge.
   */
  serpPages: 2,
  /** Warn when FBA stock covers fewer than this many days of sales. */
  lowStockDays: 21,
};

export type Settings = typeof defaults;

export function getSettings(): Settings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const stored = Object.fromEntries(rows.filter((r) => r.key in defaults).map((r) => [r.key, Number(r.value)]));
  return { ...defaults, ...stored };
}

export function saveSettings(values: Partial<Settings>) {
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [key, value] of Object.entries(values)) upsert.run(key, String(value));
}
