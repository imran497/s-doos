// End-to-end test of the Amazon API jobs against scripts/mock-amazon.mjs (no real credentials needed).
//   npm run test:amazon
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 4010;
const dbFile = path.join(os.tmpdir(), `sellerdoos-e2e-${Date.now()}.db`);
Object.assign(process.env, {
  DATABASE_PATH: dbFile,
  SELLERDOOS_KEY_FILE: `${dbFile}.key`,
  DISABLE_SCHEDULER: "true",
  SPAPI_CLIENT_ID: "test-client",
  SPAPI_CLIENT_SECRET: "test-secret",
  SPAPI_REFRESH_TOKEN: "test",
  ADS_CLIENT_ID: "test-client",
  ADS_CLIENT_SECRET: "test-secret",
  ADS_REFRESH_TOKEN: "test",
  SPAPI_ENDPOINT: `http://localhost:${PORT}`,
  ADS_ENDPOINT: `http://localhost:${PORT}`,
  LWA_TOKEN_URL: `http://localhost:${PORT}/auth/o2/token`,
  REPORT_POLL_MS: "100",
  MOCK_QUIET: process.env.VERBOSE ? "" : "1",
});

const mock = spawn(process.execPath, [path.join(import.meta.dirname, "mock-amazon.mjs"), String(PORT)], { stdio: "inherit", env: process.env });
await new Promise((r) => setTimeout(r, 500));

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok ? "" : `  →  ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
};
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

// Regression: start from a database whose fee_events table predates the qty column (the
// "no such column: qty" crash). Loading the app must upgrade it in place.
{
  const { createRequire } = await import("node:module");
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const old = new Database(dbFile);
  old.exec(`CREATE TABLE fee_events (id INTEGER PRIMARY KEY, marketplace TEXT NOT NULL, posted_date TEXT NOT NULL, order_id TEXT, sku TEXT, asin TEXT,
    kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'spapi')`);
  old.close();
}

try {
  const { db } = await import("../src/lib/db.ts");
  console.log("Old database upgraded");
  const feeColumns = (db.prepare("PRAGMA table_info(fee_events)").all() as { name: string }[]).map((c) => c.name);
  check("fee_events gained the qty column", feeColumns.includes("qty"), feeColumns);
  const { syncAmazon } = await import("../src/lib/jobs/index.ts");
  const { processReports } = await import("../src/lib/jobs/reports.ts");
  const { productProfit } = await import("../src/lib/profit.ts");

  // Phase 1, the situation a new user is in: connected, no products yet, leftover sample data.
  console.log("Connected with no products and leftover sample data");
  db.prepare("INSERT INTO sales_traffic (marketplace, asin, date, units, source) VALUES ('US', 'B0DEMO0000', '2026-01-01', 5, 'demo')").run();
  const firstSync = await syncAmazon({ waitMs: 0 });
  check("marketplaces come from the seller account (US only; CA not selling, BR unsupported)", JSON.stringify(firstSync.marketplaces) === '["US"]', firstSync.marketplaces);
  check("sample data removed once connected", (db.prepare("SELECT COUNT(*) n FROM sales_traffic WHERE source = 'demo'").get() as { n: number }).n === 0);
  check("sales reports queued without any product", (db.prepare("SELECT COUNT(*) n FROM report_requests WHERE kind = 'sales_traffic'").get() as { n: number }).n === 30);
  check("stock pulled without any product", (db.prepare("SELECT COUNT(*) n FROM inventory_snapshots").get() as { n: number }).n > 0);

  const productId = Number(db.prepare("INSERT INTO products (asin, marketplace, unit_cost) VALUES ('B0GZ8LVLGR', 'US', 6.4)").run().lastInsertRowid);
  db.prepare("INSERT INTO keywords (product_id, keyword) VALUES (?, 'magnetic tiles'), (?, 'magnet building toys')").run(productId, productId);
  db.prepare("INSERT INTO competitors (product_id, asin) VALUES (?, 'B07COMP0001')").run(productId);

  console.log("First sync (inventory, finances, listings, report queue)…");
  const first = await syncAmazon({ waitMs: 5_000 });
  check("sync ran without errors", first.errors.length === 0, first.errors);

  // Sales & Traffic is paced at 3 reports per tick; keep ticking until the queue drains.
  for (let i = 0; i < 20; i++) {
    const open = db.prepare("SELECT COUNT(*) n FROM report_requests WHERE status IN ('queued', 'pending')").get() as { n: number };
    if (!open.n) break;
    const r = await processReports({ waitMs: 3_000 });
    if (r.errors.length) check(`tick ${i} without errors`, false, r.errors);
  }

  const one = <T,>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as T;
  const all = <T,>(sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as T[];

  console.log("Report queue");
  const queue = all<{ kind: string; status: string; n: number }>("SELECT kind, status, COUNT(*) n FROM report_requests GROUP BY kind, status");
  check("every report finished", queue.every((q) => q.status === "done"), queue);

  console.log("Sales & Traffic");
  check("30 days stored", one<{ n: number }>("SELECT COUNT(*) n FROM sales_traffic_days").n === 30);
  check("two ASINs per day", one<{ n: number }>("SELECT COUNT(*) n FROM sales_traffic").n === 60);
  const st = one<{ units: number; revenue: number; sessions: number; buy_box_pct: number; date: string }>(
    "SELECT * FROM sales_traffic WHERE asin = 'B0GZ8LVLGR' ORDER BY date DESC LIMIT 1",
  );
  const day = Number(st.date.slice(8, 10));
  check("units, sessions and revenue parsed", st.units === 10 + day && st.sessions === 100 + day && near(st.revenue, (10 + day) * 24.49), st);
  const stats = (await (await fetch(`http://localhost:${PORT}/_stats`)).json()) as { throttledOnce: boolean; rejectedTopShare: boolean };
  check("a 429 was returned and the request retried (all 30 days still stored)", stats.throttledOnce);

  console.log("Orders");
  check("2 order items (Amazon-internal S01 order left out)", one<{ n: number }>("SELECT COUNT(*) n FROM orders").n === 2);
  check("orders filed under their sales channel (Amazon.com → US)", one<{ n: number }>("SELECT COUNT(*) n FROM orders WHERE marketplace != 'US'").n === 0);
  check("SKU mapped to ASIN", one<{ asin: string }>("SELECT asin FROM sku_map WHERE sku = 'KB-60'")?.asin === "B0GZ8LVLGR");

  console.log("Finances");
  const fees = all<{ kind: string; total: number }>("SELECT kind, ROUND(SUM(amount), 2) total FROM fee_events GROUP BY kind ORDER BY kind");
  const byKind = Object.fromEntries(fees.map((f) => [f.kind, f.total]));
  check("both pages imported", one<{ n: number }>("SELECT COUNT(*) n FROM fee_events").n === 7, fees);
  check("sale 48.98, tax 3.92", near(byKind.sale, 48.98) && near(byKind.tax, 3.92), byKind);
  check("fees -18.71 + 2.94 refunded commission", near(byKind.fee, -15.77), byKind);
  check("refund -24.49, storage -4.10", near(byKind.refund, -24.49) && near(byKind.service_fee, -4.1), byKind);
  check("finance rows linked to the ASIN", one<{ n: number }>("SELECT COUNT(*) n FROM fee_events WHERE asin IS NULL").n === 0);

  console.log("Re-sync is idempotent");
  await syncAmazon({ waitMs: 2_000 });
  check("finance window replaced, not duplicated", one<{ n: number }>("SELECT COUNT(*) n FROM fee_events").n === 7);

  console.log("Inventory");
  const inv = all<{ sku: string; fulfillable: number; inbound: number; reserved: number; unfulfillable: number }>("SELECT * FROM inventory_snapshots ORDER BY sku");
  check("both pages imported", inv.length === 2, inv);
  check("quantities parsed (inbound = working + shipped + receiving)", inv[0].fulfillable === 300 && inv[0].inbound === 15 && inv[0].reserved === 3 && inv[0].unfulfillable === 2, inv[0]);

  console.log("Listings & competitors");
  const rival = one<{ bsr: number; buy_box_price: number; lowest_price: number; offer_count: number }>("SELECT * FROM listing_snapshots WHERE asin = 'B07COMP0001'");
  check("competitor BSR and offers", rival?.bsr === 820 && near(rival.buy_box_price, 21.99) && near(rival.lowest_price, 20.5) && rival.offer_count === 4, rival);
  check("competitor title filled", one<{ title: string }>("SELECT title FROM competitors").title === "Rival tiles B07COMP0001");
  check("you hold the Buy Box", one<{ you_have_buy_box: number }>("SELECT you_have_buy_box FROM listing_snapshots WHERE asin = 'B0GZ8LVLGR'")?.you_have_buy_box === 1);

  console.log("Your listings become products");
  const listings = all<{ sku: string; asin: string; title: string; status: string; regular_price: number; sale_price: number | null; referral_fee: number; fba_fee: number; total_fee: number }>(
    "SELECT * FROM listings ORDER BY sku",
  );
  check("3 SKUs imported, active and inactive", listings.map((l) => `${l.sku}:${l.status}`).join(",") === "KB-100:Inactive,KB-60:Active,KB-60-M:Inactive", listings);
  check("Windows-1252 title decoded (™)", listings.find((l) => l.sku === "KB-60")?.title === "KidBees™ 60pc Magnetic Tiles", listings[1]?.title);
  check("the second ASIN was added as a product automatically", one<{ n: number }>("SELECT COUNT(*) n FROM products WHERE asin = 'B0SECOND01' AND marketplace = 'US'").n === 1);
  check("its image came from the catalog", one<{ image_url: string }>("SELECT image_url FROM products WHERE asin = 'B0SECOND01'").image_url === "https://example.com/B0SECOND01.jpg");
  const onSale = listings.find((l) => l.sku === "KB-60")!;
  check("sale price detected (20.99, regular 24.49)", near(onSale.regular_price, 24.49) && near(onSale.sale_price ?? 0, 20.99), onSale);
  check("fees estimated at the sale price (FBA 5.68 + 15% referral)", near(onSale.fba_fee, 5.68) && near(onSale.referral_fee, 3.15) && near(onSale.total_fee, 8.83), onSale);
  check("merchant-fulfilled SKU has no FBA fee", near(listings.find((l) => l.sku === "KB-60-M")!.fba_fee, 0));
  check("promotion discount stored on the order", near(one<{ d: number }>("SELECT promo_discount d FROM orders WHERE order_id = '111-0000001-0000001'").d, 5), null);

  console.log("Top Search Terms (210,000 streamed rows)");
  const terms = all<{ term: string; asin1: string; click_share1: number; frequency_rank: number }>("SELECT * FROM search_terms ORDER BY frequency_rank");
  check("kept only the 3 relevant terms", terms.length === 3, terms.map((t) => t.term));
  check("top clicked ASINs and shares", terms[0]?.term === "magnetic tiles" && terms[0].asin1 === "B07COMP0001" && near(terms[0].click_share1, 0.2), terms[0]);

  console.log("Search Query Performance");
  const sqp = one<{ search_query: string; query_volume: number; asin_purchases: number }>("SELECT * FROM sqp_weekly");
  check("SQP row stored", sqp?.search_query === "magnetic tiles" && sqp.query_volume === 5200 && sqp.asin_purchases === 18, sqp);

  console.log("Amazon Ads");
  check("US profile chosen", one<{ value: string }>("SELECT value FROM settings WHERE key = 'adsProfile:US'")?.value === "111");
  check("unsupported column rejected, report re-requested without it", stats.rejectedTopShare);
  check("search term rows", one<{ n: number }>("SELECT COUNT(*) n FROM ads_search_terms").n >= 4);
  const adsDay = one<{ cost: number; clicks: number }>("SELECT cost, clicks FROM ads_products ORDER BY date LIMIT 1");
  check("two SKUs of one ASIN summed", near(adsDay.cost, 23.5) && adsDay.clicks === 27, adsDay);

  console.log("Profit");
  // Order shipped: 48.98 sale, -18.71 fees; refund -24.49 with +2.94 commission back; storage -4.10.
  // Units sold in finances: 2 at 6.40 cost. Ad spend: everything in ads_products.
  const adSpend = one<{ s: number }>("SELECT ROUND(SUM(cost), 2) s FROM ads_products").s;
  const p = productProfit(productId, "2000-01-01", "2100-01-01");
  const expected = 48.98 - 7.35 - 11.36 - 24.49 + 2.94 - 4.1 - adSpend - 2 * 6.4;
  check(`net profit = ${expected.toFixed(2)}`, near(p.profit, expected), p);

  console.log("Shipments: landed cost and first-in, first-out");
  const { fifo, currentUnitCost, cogsBetween } = await import("../src/lib/cogs.ts");
  // The KidBees sheet's numbers: KB_001 (arrived) 204 units paid 1821.85 + 82 placement; KB_003 (in transit)
  // 504 units paid 4810.12 and 204 of another product paid 3428, sharing a 536.40 placement fee.
  const ship = db.prepare("INSERT INTO shipments (ref, order_date, status, arrived_date, placement_fee) VALUES (?, ?, ?, ?, ?)");
  const line = db.prepare("INSERT INTO shipment_items (shipment_id, asin, qty, unit_price, total_paid) VALUES (?, ?, ?, ?, ?)");
  const s1 = Number(ship.run("KB_001", "2026-05-24", "arrived", "2026-06-10", 82).lastInsertRowid);
  line.run(s1, "B0FIFOTEST", 204, 8.25, 1821.85);
  const s3 = Number(ship.run("KB_003", "2026-08-19", "in_transit", null, 536.4).lastInsertRowid);
  line.run(s3, "B0FIFOTEST", 504, 8.95, 4810.12);
  line.run(s3, "B0OTHER000", 204, 14.5, 3428);
  const fifoLayers = fifo("B0FIFOTEST").layers;
  check("landed cost matches the sheet (9.33 and 10.30)", near(fifoLayers[0].unitCost, 9.33) && near(fifoLayers[1].unitCost, 10.3), fifoLayers);
  check("other product shares the placement fee (17.56)", near(fifo("B0OTHER000").layers[0].unitCost, 17.56));
  const sale = db.prepare("INSERT INTO orders (order_id, sku, marketplace, asin, purchase_date, status, qty, item_price, currency) VALUES (?, 'FIFO', 'US', 'B0FIFOTEST', ?, 'Shipped', ?, 0, 'USD')");
  sale.run("FIFO-1", "2026-06-15T10:00:00Z", 200);
  sale.run("FIFO-2", "2026-09-01T10:00:00Z", 10);
  const matched = fifo("B0FIFOTEST");
  const all210 = cogsBetween(matched, 0, Date.parse("2027-01-01"));
  check("210 sold = 204 × 9.33 + 6 × 10.30", near(all210.cost, 204 * 9.33 + 6 * 10.3) && all210.units === 210, all210);
  check("second order costs 4 × 9.33 + 6 × 10.30", near(cogsBetween(matched, Date.parse("2026-08-01"), Date.parse("2026-10-01")).cost, 4 * 9.33 + 6 * 10.3));
  check("next unit comes from KB_003 at 10.30", currentUnitCost(matched)?.ref === "KB_003" && near(currentUnitCost(matched)!.unitCost, 10.3), currentUnitCost(matched));
  check("remaining: 0 in KB_001, 498 in KB_003", matched.layers[0].remaining === 0 && matched.layers[1].remaining === 498, matched.layers);
  db.prepare("DELETE FROM shipments WHERE id = ?").run(s3);
  check("deleting a shipment removes its lines", one<{ n: number }>("SELECT COUNT(*) n FROM shipment_items WHERE shipment_id = ?", s3).n === 0);
  check("units beyond shipments are costed at the last known cost", near(cogsBetween(fifo("B0FIFOTEST"), 0, Date.parse("2027-01-01")).cost, 210 * 9.33));

  console.log("Misc charges from Amazon");
  const expenses = all<{ category: string; description: string; amount: number }>("SELECT category, description, amount FROM expenses WHERE source = 'spapi' ORDER BY category");
  const byCategory = Object.fromEntries(expenses.map((e) => [e.category, e.amount]));
  check("both pages read, order payment left out", expenses.length === 6, expenses);
  check("subscription, storage and coupon fees stored as money out", near(byCategory.amazon_subscription, 39.99) && near(byCategory.amazon_storage, 0.53) && near(byCategory.amazon_promotions, 5), byCategory);
  check("inbound fee marked as part of shipment cost", near(byCategory.amazon_inbound, 82), byCategory);
  check("negative balance payment is a transfer, stored as money out", near(byCategory.amazon_debt, 39.99), byCategory);
  check("reimbursement stored as money back", near(byCategory.amazon_reimbursement, -7.55), byCategory);
  check("readable descriptions", expenses.find((e) => e.category === "amazon_storage")?.description === "Monthly storage fee", expenses);
  const { syncExpenses } = await import("../src/lib/jobs/expenses.ts");
  await syncExpenses(["US"]);
  check("re-sync doesn't duplicate", one<{ n: number }>("SELECT COUNT(*) n FROM expenses WHERE source = 'spapi'").n === 6);
} catch (error) {
  console.error(error);
  failures++;
} finally {
  mock.kill();
  fs.rmSync(dbFile, { force: true });
  fs.rmSync(`${dbFile}-wal`, { force: true });
  fs.rmSync(`${dbFile}-shm`, { force: true });
  fs.rmSync(`${dbFile}.key`, { force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
