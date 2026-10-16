import { listTransactions } from "../amazon/spapi";
import { addDays, db, today } from "../db";
import { amazonDescription, classifyAmazonTransaction } from "../expenses-meta";
import type { MarketplaceCode } from "../marketplaces";
import { rememberSellerId } from "../seller";

// Imports Amazon account charges (subscription, storage, coupons, Vine, inbound fees, reimbursements,
// negative-balance payments) into misc charges, from SP-API Finances transactions. The first run goes back
// 18 months; later runs re-read the last 30 days, since Amazon posts some charges late.

const FIRST_RUN_DAYS = 540;
const WINDOW_DAYS = 179; // Amazon allows up to 180 days per request

export async function syncExpenses(markets: MarketplaceCode[]) {
  const syncedKey = "expenses:syncedThrough";
  const synced = (db.prepare("SELECT value FROM settings WHERE key = ?").get(syncedKey) as { value: string } | undefined)?.value;
  const end = addDays(today(), 1);
  let start = synced ? addDays(synced, -30) : addDays(today(), -FIRST_RUN_DAYS);

  const save = db.prepare(`
    INSERT INTO expenses (date, category, description, amount, currency, source, external_id)
    VALUES (@date, @category, @description, @amount, @currency, 'spapi', @externalId)
    ON CONFLICT(external_id) DO UPDATE SET date = excluded.date, category = excluded.category,
      description = excluded.description, amount = excluded.amount, currency = excluded.currency`);
  let stored = 0;
  const errors: string[] = [];
  const seen = new Set<string>();

  for (; start < end; start = addDays(start, WINDOW_DAYS)) {
    const windowEnd = addDays(start, WINDOW_DAYS) < end ? addDays(start, WINDOW_DAYS) : end;
    for (const m of markets) {
      try {
        const rows = await listTransactions(m, start, windowEnd);
        // Remember your seller id (used to recognise your own offer for the Buy Box).
        const sellerId = rows.find((r) => r.sellerId)?.sellerId;
        if (sellerId) rememberSellerId(sellerId);
        db.transaction(() => {
          for (const t of rows) {
            if (seen.has(t.id) || !t.amount) continue;
            seen.add(t.id);
            const category = classifyAmazonTransaction(t.type, t.description);
            if (!category) continue;
            save.run({
              date: t.postedDate.slice(0, 10),
              category,
              description: amazonDescription(t.type, t.description),
              // Stored as money out: Amazon reports fees as negative amounts. A negative-balance payment is
              // money from your card into the seller account, so it's money out for you too.
              amount: category === "amazon_debt" ? Math.abs(t.amount) : -t.amount,
              currency: t.currency || "USD",
              externalId: `spapi:${t.id}`,
            });
            stored++;
          }
        })();
      } catch (error) {
        errors.push(`Misc charges ${m}: ${(error as Error).message}`);
      }
    }
  }
  if (!errors.length) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(syncedKey, today());
  }
  return { stored, errors };
}
