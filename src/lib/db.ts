import Database from "better-sqlite3";

// Loaded this way so the build's file tracer doesn't copy your local database into the server bundle.
const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
const path = process.getBuiltinModule("node:path") as typeof import("node:path");

// One SQLite file holds everything. Delete data/sellerdoos.db to start fresh.
const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "sellerdoos.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY,
  asin        TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'US',
  title       TEXT,
  image_url   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (asin, marketplace)
);

CREATE TABLE IF NOT EXISTS keywords (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  keyword    TEXT NOT NULL,
  tags       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (product_id, keyword)
);

-- One row per keyword per day. A NULL rank means the ASIN wasn't found within the pages checked.
CREATE TABLE IF NOT EXISTS rank_checks (
  id             INTEGER PRIMARY KEY,
  keyword_id     INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  checked_on     TEXT NOT NULL,
  organic_rank   INTEGER,
  sponsored_rank INTEGER,
  pages_checked  INTEGER NOT NULL,
  source         TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (keyword_id, checked_on)
);

CREATE TABLE IF NOT EXISTS bsr_snapshots (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  checked_on TEXT NOT NULL,
  category   TEXT NOT NULL,
  rank       INTEGER NOT NULL,
  UNIQUE (product_id, checked_on, category)
);

-- Search Query Performance, one row per search query per week (from SP-API Brand Analytics).
CREATE TABLE IF NOT EXISTS sqp_weekly (
  id               INTEGER PRIMARY KEY,
  product_id       INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  week_start       TEXT NOT NULL,
  week_end         TEXT NOT NULL,
  search_query     TEXT NOT NULL,
  query_volume     INTEGER,
  impressions      INTEGER,
  asin_impressions INTEGER,
  clicks           INTEGER,
  asin_clicks      INTEGER,
  cart_adds        INTEGER,
  asin_cart_adds   INTEGER,
  purchases        INTEGER,
  asin_purchases   INTEGER,
  UNIQUE (product_id, week_start, search_query)
);

-- Amazon builds reports asynchronously (minutes to hours), so every report request is queued here:
-- created when Amazon's rate limits allow, then polled and stored by the scheduler.
-- kind: sqp, sales_traffic, orders, listings, search_terms, ads_search_terms, ads_products.
-- scope: what it covers, e.g. a product id (sqp), a marketplace code, or "US:<ads profile id>".
CREATE TABLE IF NOT EXISTS report_requests (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL,
  scope        TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  external_id  TEXT,
  status       TEXT NOT NULL DEFAULT 'queued',
  attempts     INTEGER NOT NULL DEFAULT 0,
  message      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (kind, scope, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS report_requests_open ON report_requests (status);

-- Map seller SKUs to ASINs (finance events only carry the SKU).
CREATE TABLE IF NOT EXISTS sku_map (
  sku  TEXT PRIMARY KEY,
  asin TEXT NOT NULL
);

-- Daily sales and traffic per ASIN (SP-API Sales & Traffic report, Brand Analytics role).
CREATE TABLE IF NOT EXISTS sales_traffic (
  marketplace      TEXT NOT NULL,
  asin             TEXT NOT NULL,
  date             TEXT NOT NULL,
  units            INTEGER NOT NULL DEFAULT 0,
  revenue          REAL NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT '',
  order_items      INTEGER NOT NULL DEFAULT 0,
  sessions         INTEGER NOT NULL DEFAULT 0,
  page_views       INTEGER NOT NULL DEFAULT 0,
  buy_box_pct      REAL,
  unit_session_pct REAL,
  source           TEXT NOT NULL DEFAULT 'spapi',
  PRIMARY KEY (marketplace, asin, date)
);
-- Days whose Sales & Traffic report has been stored (a day with no sales still counts).
CREATE TABLE IF NOT EXISTS sales_traffic_days (
  marketplace TEXT NOT NULL,
  date        TEXT NOT NULL,
  PRIMARY KEY (marketplace, date)
);

-- Order items (SP-API all-orders flat file report). No customer data is stored.
CREATE TABLE IF NOT EXISTS orders (
  order_id      TEXT NOT NULL,
  sku           TEXT NOT NULL,
  marketplace   TEXT NOT NULL,
  asin          TEXT NOT NULL,
  purchase_date TEXT NOT NULL,
  status        TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT '',
  product_name  TEXT NOT NULL DEFAULT '',
  qty           INTEGER NOT NULL DEFAULT 0,
  item_price    REAL NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT '',
  -- Promotion discount on the item (coupons, deals, Prime offers…) and the promotion ids Amazon applied.
  promo_discount REAL NOT NULL DEFAULT 0,
  promo_ids     TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT 'spapi',
  PRIMARY KEY (order_id, sku)
);
CREATE INDEX IF NOT EXISTS orders_date ON orders (purchase_date);

-- Money Amazon recorded per order item: sales, fees, refunds, promotions, service fees, adjustments.
-- Amounts are signed: money in is positive, fees and refunds negative.
CREATE TABLE IF NOT EXISTS fee_events (
  id          INTEGER PRIMARY KEY,
  marketplace TEXT NOT NULL,
  posted_date TEXT NOT NULL,
  order_id    TEXT,
  sku         TEXT,
  asin        TEXT,
  kind        TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  amount      REAL NOT NULL,
  currency    TEXT NOT NULL DEFAULT '',
  -- Units shipped, on sale (Principal) rows only; used for cost of goods.
  qty         INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'spapi'
);
CREATE INDEX IF NOT EXISTS fee_events_date ON fee_events (marketplace, posted_date);

-- FBA stock per SKU, one snapshot a day.
CREATE TABLE IF NOT EXISTS inventory_snapshots (
  marketplace   TEXT NOT NULL,
  date          TEXT NOT NULL,
  sku           TEXT NOT NULL,
  asin          TEXT NOT NULL,
  fulfillable   INTEGER NOT NULL DEFAULT 0,
  inbound       INTEGER NOT NULL DEFAULT 0,
  reserved      INTEGER NOT NULL DEFAULT 0,
  unfulfillable INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL DEFAULT 'spapi',
  PRIMARY KEY (marketplace, date, sku)
);

-- Sponsored Products: shopper search terms that triggered ads (Ads API spSearchTerm), per day.
CREATE TABLE IF NOT EXISTS ads_search_terms (
  id          INTEGER PRIMARY KEY,
  marketplace TEXT NOT NULL,
  date        TEXT NOT NULL,
  search_term TEXT NOT NULL,
  keyword     TEXT,
  match_type  TEXT,
  campaign    TEXT,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks      INTEGER NOT NULL DEFAULT 0,
  cost        REAL NOT NULL DEFAULT 0,
  purchases   INTEGER NOT NULL DEFAULT 0,
  sales       REAL NOT NULL DEFAULT 0,
  units       INTEGER NOT NULL DEFAULT 0,
  top_share   REAL,
  source      TEXT NOT NULL DEFAULT 'ads'
);
CREATE INDEX IF NOT EXISTS ads_search_terms_day ON ads_search_terms (marketplace, date);
CREATE INDEX IF NOT EXISTS ads_search_terms_term ON ads_search_terms (search_term);

-- Sponsored Products spend and sales per advertised ASIN (Ads API spAdvertisedProduct), per day.
CREATE TABLE IF NOT EXISTS ads_products (
  marketplace TEXT NOT NULL,
  date        TEXT NOT NULL,
  asin        TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks      INTEGER NOT NULL DEFAULT 0,
  cost        REAL NOT NULL DEFAULT 0,
  purchases   INTEGER NOT NULL DEFAULT 0,
  sales       REAL NOT NULL DEFAULT 0,
  units       INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'ads',
  PRIMARY KEY (marketplace, date, asin)
);

-- Competitor ASINs watched against one of your products.
CREATE TABLE IF NOT EXISTS competitors (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  asin        TEXT NOT NULL,
  title       TEXT,
  brand       TEXT,
  image_url   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (product_id, asin)
);

-- Daily BSR and offer snapshots for any watched ASIN (your products and competitors).
CREATE TABLE IF NOT EXISTS listing_snapshots (
  marketplace     TEXT NOT NULL,
  asin            TEXT NOT NULL,
  date            TEXT NOT NULL,
  bsr             INTEGER,
  bsr_category    TEXT,
  buy_box_price   REAL,
  lowest_price    REAL,
  currency        TEXT NOT NULL DEFAULT '',
  offer_count     INTEGER,
  you_have_buy_box INTEGER,
  source          TEXT NOT NULL DEFAULT 'spapi',
  PRIMARY KEY (marketplace, asin, date)
);

-- Your own listings, one row per SKU (SP-API "all listings" report), with current prices and estimated fees.
-- Every listed ASIN also gets a products row, so nothing has to be added by hand.
CREATE TABLE IF NOT EXISTS listings (
  marketplace   TEXT NOT NULL,
  sku           TEXT NOT NULL,
  asin          TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT '',
  -- AMAZON_NA etc. for FBA, DEFAULT for merchant-fulfilled.
  fulfillment   TEXT NOT NULL DEFAULT '',
  price         REAL,
  quantity      INTEGER,
  open_date     TEXT,
  currency      TEXT NOT NULL DEFAULT '',
  -- From the Pricing API: the regular price and, when a sale is running, the lower price shoppers pay.
  regular_price REAL,
  sale_price    REAL,
  -- From the Product Fees API, estimated at the current price.
  referral_fee  REAL,
  fba_fee       REAL,
  total_fee     REAL,
  fees_at       TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  source        TEXT NOT NULL DEFAULT 'spapi',
  PRIMARY KEY (marketplace, sku)
);
CREATE INDEX IF NOT EXISTS listings_asin ON listings (marketplace, asin);

-- Inventory you bought and sent to Amazon, entered by hand. Their landed cost is your cost of goods:
-- each line's cost per unit = total paid ÷ qty + the shipment's shared costs (Amazon placement fee and
-- any other) ÷ all units in the shipment. Sales use it first-in, first-out (src/lib/cogs.ts).
CREATE TABLE IF NOT EXISTS shipments (
  id            INTEGER PRIMARY KEY,
  ref           TEXT NOT NULL UNIQUE,
  supplier      TEXT NOT NULL DEFAULT '',
  order_date    TEXT NOT NULL,
  -- ordered, in_transit, arrived (available at Amazon)
  status        TEXT NOT NULL DEFAULT 'ordered',
  arrived_date  TEXT,
  placement_fee REAL NOT NULL DEFAULT 0,
  other_costs   REAL NOT NULL DEFAULT 0,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS shipment_items (
  id           INTEGER PRIMARY KEY,
  shipment_id  INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  asin         TEXT NOT NULL,
  qty          INTEGER NOT NULL,
  unit_price   REAL NOT NULL DEFAULT 0,
  misc_charges REAL NOT NULL DEFAULT 0,
  -- What was actually charged for the line (supplier price, shipping/DDP, card fees…).
  total_paid   REAL NOT NULL,
  notes        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS shipment_items_asin ON shipment_items (asin);

-- Misc charges: business costs outside per-order fees. Amazon account charges (subscription, storage,
-- coupons, Vine…) are imported from the SP-API Finances transactions; the rest is entered by hand.
-- amount is money out (a reimbursement is negative). Categories are keys from src/lib/expenses-meta.ts or
-- custom categories below.
CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,
  category    TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount      REAL NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'USD',
  notes       TEXT NOT NULL DEFAULT '',
  -- manual, spapi, sheet
  source      TEXT NOT NULL DEFAULT 'manual',
  -- Amazon transaction id or sheet cell, so imports never duplicate.
  external_id TEXT UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS expenses_date ON expenses (date);

CREATE TABLE IF NOT EXISTS expense_categories (
  key        TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  position   INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Brand Analytics Top Search Terms (weekly), filtered to terms relevant to you on import.
CREATE TABLE IF NOT EXISTS search_terms (
  marketplace     TEXT NOT NULL,
  week_start      TEXT NOT NULL,
  term            TEXT NOT NULL,
  frequency_rank  INTEGER NOT NULL,
  department      TEXT NOT NULL DEFAULT '',
  asin1 TEXT, click_share1 REAL, conversion_share1 REAL,
  asin2 TEXT, click_share2 REAL, conversion_share2 REAL,
  asin3 TEXT, click_share3 REAL, conversion_share3 REAL,
  source          TEXT NOT NULL DEFAULT 'spapi',
  PRIMARY KEY (marketplace, week_start, term)
);
CREATE INDEX IF NOT EXISTS search_terms_rank ON search_terms (marketplace, week_start, frequency_rank);

-- Searches queued with an asynchronous provider (DataForSEO), waiting to be collected.
CREATE TABLE IF NOT EXISTS serp_tasks (
  id         INTEGER PRIMARY KEY,
  task_id    TEXT NOT NULL UNIQUE,
  keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  checked_on TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  message    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS serp_tasks_pending ON serp_tasks (status);

CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,
  started_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  finished_at TEXT,
  status      TEXT NOT NULL DEFAULT 'running',
  message     TEXT
);

-- Security-relevant events (rejected logins, refused API access, forged connect attempts) for the
-- incident response plan in docs/incident-response-plan.md.
CREATE TABLE IF NOT EXISTS security_events (
  id           INTEGER PRIMARY KEY,
  at           TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  kind         TEXT NOT NULL,
  detail       TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Where an uploaded backup waits until the next start (Settings → Data → Restore). */
export const RESTORE_PATH = `${DB_PATH}.restore`;
export const databasePath = () => DB_PATH;

function open() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  // A restore is applied while nothing has the database open: swap the files in, then open.
  if (fs.existsSync(RESTORE_PATH)) {
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
    fs.renameSync(RESTORE_PATH, DB_PATH);
    console.log("[SellerDoos] restored the database from an uploaded backup");
  }
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

/** Creates missing tables and columns. Cheap and idempotent, so it runs every time this module loads. */
function ensureSchema(db: Database.Database) {
  db.exec(SCHEMA);
  migrate(db);
  addMissingColumns(db);
}

/**
 * Adds any column that's in SCHEMA but missing from an existing table (CREATE TABLE IF NOT EXISTS never
 * alters a table that already exists). Columns that are NOT NULL without a default can't be added this way
 * and are reported instead.
 */
function addMissingColumns(db: Database.Database) {
  for (const [, table, body] of SCHEMA.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)) {
    const existing = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    for (const raw of body.split("\n")) {
      const line = raw.replace(/--.*$/, "").trim().replace(/,$/, "");
      const match = line.match(/^([a-z_][a-z0-9_]*)\s+(.+)$/i);
      if (!match || /^(UNIQUE|PRIMARY|CONSTRAINT|FOREIGN|CHECK)$/i.test(match[1])) continue;
      const [, column, definition] = match;
      if (existing.has(column)) continue;
      if (/NOT NULL/i.test(definition) && !/DEFAULT/i.test(definition)) {
        console.warn(`[SellerDoos] can't add column ${table}.${column} to an existing table (NOT NULL without default)`);
        continue;
      }
      // SQLite can't add a column with a non-constant default such as datetime('now'); add it as nullable instead.
      const sql = /DEFAULT \(/i.test(definition) ? definition.replace(/NOT NULL/i, "").replace(/DEFAULT \(.*\)\s*$/i, "") : definition;
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sql}`);
      } catch (error) {
        console.warn(`[SellerDoos] couldn't add column ${table}.${column}: ${(error as Error).message}`);
      }
    }
  }
}

/** Columns added after the first release; added in place so existing databases keep their data. */
function migrate(db: Database.Database) {
  const addColumn = (table: string, column: string, type: string) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  };
  // Estimated monthly searches from DataForSEO, and when it was last fetched.
  addColumn("keywords", "est_volume", "INTEGER");
  addColumn("keywords", "est_volume_at", "TEXT");
  // Cost of goods per unit, entered by the user, for profit.
  addColumn("products", "unit_cost", "REAL");
  addColumn("sqp_weekly", "source", "TEXT NOT NULL DEFAULT 'spapi'");
  addColumn("bsr_snapshots", "source", "TEXT NOT NULL DEFAULT 'spapi'");
  // Units shipped on finance sale rows (added after fee_events first shipped).
  addColumn("fee_events", "qty", "INTEGER NOT NULL DEFAULT 0");

  // Amazon's internal non-retail orders (no price, no currency, e.g. S01-…) were once stored as sales.
  db.prepare("DELETE FROM orders WHERE currency = '' AND item_price = 0 AND source = 'spapi'").run();

  // Starting categories for misc charges you enter yourself (you can add more).
  const category = db.prepare("INSERT OR IGNORE INTO expense_categories (key, name, position) VALUES (?, ?, ?)");
  [
    ["tools", "Tools & subscriptions"],
    ["samples", "Samples"],
    ["trademark", "Trademark & legal"],
    ["upc", "UPC codes"],
    ["inspections", "Inspections"],
    ["prep", "Prep & supplies"],
    ["other", "Other"],
  ].forEach(([key, name], i) => category.run(key, name, (i + 1) * 10));

  // Orders used to be filed under the marketplace that was asked for, but Amazon's orders report covers
  // the whole region. Re-file any order whose currency doesn't match its marketplace (e.g. USD orders
  // stored as Mexico) under the marketplace in the same region that uses that currency.
  const refile = [
    ["US", "USD", ["CA", "MX"]],
    ["CA", "CAD", ["US", "MX"]],
    ["MX", "MXN", ["US", "CA"]],
    ["UK", "GBP", ["DE", "FR", "IT", "ES"]],
  ] as const;
  for (const [target, currency, others] of refile) {
    db.prepare(`UPDATE orders SET marketplace = ? WHERE currency = ? AND marketplace IN (${others.map(() => "?").join(",")})`).run(target, currency, ...others);
  }

  // The SQP-only queue became the general report queue.
  const hasOldQueue = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqp_reports'").get();
  if (hasOldQueue) {
    db.exec(`
      INSERT OR IGNORE INTO report_requests (kind, scope, period_start, period_end, external_id, status, message, created_at)
        SELECT 'sqp', CAST(product_id AS TEXT), week_start, week_end, report_id,
               CASE WHEN status = 'DONE' THEN 'done' ELSE 'pending' END, message, created_at
        FROM sqp_reports;
      DROP TABLE sqp_reports;
    `);
  }
}

// Reuse one connection across hot reloads in development, but always bring the schema up to date:
// a long-running `npm run dev` otherwise keeps an old schema after the code changes.
const globalForDb = globalThis as unknown as { sellerdoosDb?: Database.Database };
export const db = globalForDb.sellerdoosDb ?? open();
globalForDb.sellerdoosDb = db;
ensureSchema(db);

export { addDays, today } from "./dates";
