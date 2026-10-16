import { addDays, db, today } from "../db";
import type { MarketplaceCode } from "../marketplaces";
import { lastFullWeek } from "../amazon/spapi";

// Made-up but stable sample data for the Amazon API features, so every screen can be explored before
// API access is approved. Rows are written with source = 'demo' and removed by "Clear demo data".
// Writing is idempotent: the same day always produces the same numbers.

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  // Final mixing so near-identical inputs (consecutive dates) give unrelated values.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const dayIndex = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

type Product = { id: number; asin: string; marketplace: MarketplaceCode; title: string | null };

const price = (asin: string) => Math.floor(17 + hash(asin) * 15) + 0.49;

/** Fills 30 days of sales, orders, fees, inventory, listings, SQP and research data. */
export function fillSellerDemo() {
  const products = db.prepare("SELECT id, asin, marketplace, title FROM products").all() as Product[];
  const end = addDays(today(), -1);
  const days = Array.from({ length: 30 }, (_, i) => addDays(end, -29 + i));

  const sales = db.prepare(`
    INSERT INTO sales_traffic (marketplace, asin, date, units, revenue, currency, order_items, sessions, page_views, buy_box_pct, unit_session_pct, source)
    VALUES (@m, @asin, @date, @units, @revenue, 'USD', @units, @sessions, @pageViews, @buyBox, @cvr, 'demo')
    ON CONFLICT(marketplace, asin, date) DO UPDATE SET units = excluded.units, revenue = excluded.revenue, sessions = excluded.sessions,
      page_views = excluded.page_views, buy_box_pct = excluded.buy_box_pct, unit_session_pct = excluded.unit_session_pct, source = 'demo'
    WHERE sales_traffic.source = 'demo'`);
  const order = db.prepare(`
    INSERT OR IGNORE INTO orders (order_id, sku, marketplace, asin, purchase_date, status, channel, product_name, qty, item_price, currency,
      promo_discount, promo_ids, source)
    VALUES (?, ?, ?, ?, ?, ?, 'Amazon', ?, ?, ?, 'USD', ?, ?, 'demo')`);
  const fee = db.prepare(`
    INSERT INTO fee_events (marketplace, posted_date, order_id, sku, asin, kind, detail, amount, currency, qty, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, 'demo')`);
  const listing = db.prepare(`
    INSERT INTO listing_snapshots (marketplace, asin, date, bsr, bsr_category, buy_box_price, lowest_price, currency, offer_count, you_have_buy_box, source)
    VALUES (?, ?, ?, ?, 'Toys & Games', ?, ?, 'USD', ?, ?, 'demo')
    ON CONFLICT(marketplace, asin, date) DO UPDATE SET bsr = excluded.bsr, buy_box_price = excluded.buy_box_price,
      lowest_price = excluded.lowest_price, offer_count = excluded.offer_count, you_have_buy_box = excluded.you_have_buy_box, source = 'demo'
    WHERE listing_snapshots.source = 'demo'`);
  const bsr = db.prepare(`
    INSERT INTO bsr_snapshots (product_id, checked_on, category, rank, source) VALUES (?, ?, ?, ?, 'demo')
    ON CONFLICT(product_id, checked_on, category) DO NOTHING`);
  const map = db.prepare("INSERT OR IGNORE INTO sku_map (sku, asin) VALUES (?, ?)");

  db.transaction(() => {
    db.prepare("DELETE FROM fee_events WHERE source = 'demo'").run();
    for (const p of products) {
      const m = p.marketplace;
      const sku = `SD-${p.asin.slice(-5)}`;
      const unitPrice = price(p.asin);
      map.run(sku, p.asin);
      // The listing itself, with a sale running on some products and Amazon-style fee estimates.
      const onSale = hash(`${p.asin}sale`) < 0.4;
      db.prepare(`
        INSERT INTO listings (marketplace, sku, asin, title, status, fulfillment, price, open_date, currency, regular_price, sale_price,
          referral_fee, fba_fee, total_fee, fees_at, source)
        VALUES (?, ?, ?, ?, 'Active', 'AMAZON_NA', ?, ?, 'USD', ?, ?, ?, 5.68, ?, ?, 'demo')
        ON CONFLICT(marketplace, sku) DO NOTHING`).run(
        m,
        sku,
        p.asin,
        p.title ?? "Demo product",
        unitPrice,
        addDays(today(), -200),
        unitPrice,
        onSale ? round2(unitPrice * 0.85) : null,
        round2(unitPrice * (onSale ? 0.85 : 1) * 0.15),
        round2(unitPrice * (onSale ? 0.85 : 1) * 0.15 + 5.68),
        today(),
      );
      let stock = 900 + Math.round(hash(`${p.asin}stock`) * 400);

      for (const date of days) {
        const di = dayIndex(date);
        const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) ? 1.25 : 1;
        const trend = 1 + Math.sin(di / 9 + hash(p.asin) * 6) * 0.12;
        const sessions = Math.round((90 + hash(`${p.asin}${date}s`) * 80) * weekend * trend);
        const cvr = 0.08 + hash(`${p.asin}${date}c`) * 0.06;
        const units = Math.max(0, Math.round(sessions * cvr));
        sales.run({ m, asin: p.asin, date, units, revenue: round2(units * unitPrice), sessions, pageViews: Math.round(sessions * 1.4), buyBox: 96 + hash(`${date}bb`) * 4, cvr: round2((units / sessions) * 100) });

        // Orders of 1–2 units, with Amazon's referral (15%) and FBA fees posted the same day.
        let left = units;
        let n = 0;
        while (left > 0) {
          const qty = Math.min(left, hash(`${p.asin}${date}${n}q`) < 0.85 ? 1 : 2);
          const orderId = `DEMO-${di}-${p.id}-${n}`;
          const status = hash(`${orderId}st`) < 0.03 ? "Cancelled" : date >= addDays(end, -1) ? "Pending" : "Shipped";
          const promo = onSale && hash(`${orderId}promo`) < 0.3 ? round2(unitPrice * qty * 0.15) : 0;
          order.run(orderId, sku, m, p.asin, `${date}T${String(8 + (n % 14)).padStart(2, "0")}:15:00Z`, status, p.title ?? "Demo product", qty, round2(unitPrice * qty), promo, promo ? "DEMO-COUPON" : "");
          if (status === "Shipped") {
            fee.run(m, date, orderId, sku, p.asin, "sale", "Principal", round2(unitPrice * qty), qty);
            fee.run(m, date, orderId, sku, p.asin, "fee", "Commission", round2(-unitPrice * qty * 0.15), 0);
            fee.run(m, date, orderId, sku, p.asin, "fee", "FBAPerUnitFulfillmentFee", round2(-5.68 * qty), 0);
            if (hash(`${orderId}r`) < 0.04) fee.run(m, addDays(date, 1) > end ? date : addDays(date, 1), orderId, sku, p.asin, "refund", "Principal", round2(-unitPrice * qty), 0);
          }
          stock -= qty;
          left -= qty;
          n++;
        }

        const rank = Math.round(1800 + Math.sin(di / 4 + hash(p.asin) * 6) * 600 + hash(`${p.asin}${date}r`) * 300);
        bsr.run(p.id, date, "Toys & Games", rank);
        listing.run(m, p.asin, date, rank, unitPrice, round2(unitPrice - (hash(`${date}low`) < 0.2 ? 1 : 0)), 1 + Math.round(hash(`${date}oc`) * 2), hash(`${p.asin}${date}bb`) < 0.94 ? 1 : 0);
      }
      fee.run(m, days[days.length - 1], null, sku, p.asin, "service_fee", "FBAStorageFee", round2(-0.87 * (stock / 40)), 0);

      db.prepare(`
        INSERT INTO inventory_snapshots (marketplace, date, sku, asin, fulfillable, inbound, reserved, unfulfillable, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'demo')
        ON CONFLICT(marketplace, date, sku) DO UPDATE SET fulfillable = excluded.fulfillable, inbound = excluded.inbound WHERE inventory_snapshots.source = 'demo'`).run(
        m,
        today(),
        sku,
        p.asin,
        Math.max(stock, 40),
        hash(`${p.asin}in`) < 0.5 ? 300 : 0,
        Math.round(hash(`${p.asin}rs`) * 25),
        Math.round(hash(`${p.asin}uf`) * 6),
      );

      // Competitors: a price and BSR history around yours.
      const rivals = db.prepare("SELECT asin FROM competitors WHERE product_id = ?").all(p.id) as { asin: string }[];
      for (const r of rivals) {
        for (const date of days) {
          const di = dayIndex(date);
          const base = price(r.asin) + (di % 11 === 0 ? -2 : 0);
          listing.run(m, r.asin, date, Math.round(900 + hash(r.asin) * 4000 + Math.cos(di / 5) * 400), base, round2(base - 0.5), 2 + Math.round(hash(`${r.asin}${date}`) * 6), 0);
        }
      }
    }
  })();

  fillSqpDemo(products);
  fillSearchTermsDemo(products);
}

function fillSqpDemo(products: Product[]) {
  const week = lastFullWeek();
  const save = db.prepare(`
    INSERT INTO sqp_weekly (product_id, week_start, week_end, search_query, query_volume, impressions, asin_impressions, clicks,
      asin_clicks, cart_adds, asin_cart_adds, purchases, asin_purchases, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo')
    ON CONFLICT(product_id, week_start, search_query) DO NOTHING`);
  db.transaction(() => {
    for (const p of products) {
      const keywords = (db.prepare("SELECT keyword FROM keywords WHERE product_id = ?").all(p.id) as { keyword: string }[]).map((k) => k.keyword);
      const extra = ["magnetic tiles for toddlers 2-4", "magnet building toys", "stem toys for 4 year old", "montessori magnetic tiles"];
      for (const q of [...keywords, ...extra]) {
        const volume = Math.round(200 + hash(`${q}v`) * 9000);
        const impressions = volume * 12;
        const clicks = Math.round(volume * 0.4);
        const share = 0.01 + hash(`${p.asin}${q}`) * 0.12;
        save.run(p.id, week.start, week.end, q, volume, impressions, Math.round(impressions * share), clicks, Math.round(clicks * share), Math.round(clicks * 0.25), Math.round(clicks * 0.25 * share), Math.round(clicks * 0.1), Math.round(clicks * 0.1 * share));
      }
    }
  })();
}

function fillSearchTermsDemo(products: Product[]) {
  if (!products.length) return;
  // Searches built from your tracked keywords plus common shopper modifiers.
  const keywords = (db.prepare("SELECT keyword FROM keywords").all() as { keyword: string }[]).map((k) => k.keyword);
  const bases = keywords.length ? keywords.slice(0, 8) : ["magnetic tiles"];
  const modifiers = ["", "for toddlers", "for kids 3-5", "100 pieces", "set", "with storage", "castle", "car ramp", "glow in the dark", "for boys", "for girls", "montessori"];
  const rivals = ["B07DEMO0001", "B08DEMO0002", "B09DEMO0003", "B0ADEMO0004", "B0BDEMO0005", "B0CDEMO0006"];
  const save = db.prepare(`
    INSERT INTO search_terms (marketplace, week_start, term, frequency_rank, department, asin1, click_share1, conversion_share1,
      asin2, click_share2, conversion_share2, asin3, click_share3, conversion_share3, source)
    VALUES (?, ?, ?, ?, 'amazon.com', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo')
    ON CONFLICT(marketplace, week_start, term) DO NOTHING`);
  const m = products[0].marketplace;
  const thisWeek = lastFullWeek().start;
  db.transaction(() => {
    for (const week of [addDays(thisWeek, -7), thisWeek]) {
      for (const base of bases) {
        for (const mod of modifiers) {
          const term = `${base} ${mod}`.trim();
          const drift = week === thisWeek ? 1 : 0.9 + hash(`${term}w`) * 0.25;
          const rank = Math.round((mod ? 2_000 + hash(term) * 120_000 : 200 + hash(term) * 9_000) * drift);
          // Three different products per search; sometimes yours is among them.
          const start = Math.floor(hash(`${term}a`) * rivals.length);
          const asins = [0, 1, 2].map((i) => rivals[(start + i) % rivals.length]);
          if (hash(`${term}you`) < 0.2) asins[1] = products[0].asin;
          const share = 0.12 + hash(`${term}s`) * 0.2;
          save.run(m, week, term, rank, asins[0], share, share * 0.8, asins[1], share * 0.6, share * 0.5, asins[2], share * 0.35, share * 0.3);
        }
      }
    }
  })();
}

/** Sponsored Products demo data for the last 30 days, built around your tracked keywords. */
export function fillAdsDemo() {
  const products = db.prepare("SELECT id, asin, marketplace FROM products").all() as Product[];
  const end = addDays(today(), -1);
  const days = Array.from({ length: 30 }, (_, i) => addDays(end, -29 + i));
  const term = db.prepare(`
    INSERT INTO ads_search_terms (marketplace, date, search_term, keyword, match_type, campaign, impressions, clicks, cost, purchases, sales, units, top_share, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo')`);
  const prod = db.prepare(`
    INSERT INTO ads_products (marketplace, date, asin, impressions, clicks, cost, purchases, sales, units, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo')
    ON CONFLICT(marketplace, date, asin) DO UPDATE SET impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      purchases = excluded.purchases, sales = excluded.sales, units = excluded.units, source = 'demo' WHERE ads_products.source = 'demo'`);
  db.transaction(() => {
    db.prepare("DELETE FROM ads_search_terms WHERE source = 'demo'").run();
    const campaign = db.prepare(
      "INSERT INTO ads_campaign_asins (marketplace, campaign, ad_group, asin, last_date, source) VALUES (?, ?, '', ?, ?, 'demo') ON CONFLICT DO NOTHING",
    );
    for (const p of products) {
      campaign.run(p.marketplace, `SP - ${p.asin}`, p.asin, end);
      const keywords = (db.prepare("SELECT keyword FROM keywords WHERE product_id = ?").all(p.id) as { keyword: string }[]).map((k) => k.keyword);
      const terms = [...keywords, "magnet tiles 100 pcs", "magnetic blocks for 3 year olds", "building toys for boys 4-6"];
      const unitPrice = price(p.asin);
      for (const date of days) {
        let cost = 0;
        let clicksTotal = 0;
        let impressionsTotal = 0;
        let salesTotal = 0;
        let purchasesTotal = 0;
        for (const t of terms) {
          if (hash(`${t}${date}on`) < 0.25) continue;
          const impressions = Math.round(150 + hash(`${t}${date}i`) * 1200);
          const clicks = Math.round(impressions * (0.004 + hash(`${t}${date}ctr`) * 0.01));
          const cpc = 0.55 + hash(`${t}cpc`) * 0.9;
          const purchases = Math.round(clicks * (hash(`${t}cvr`) * 0.18));
          const spend = round2(clicks * cpc);
          term.run(p.marketplace, date, t, keywords.includes(t) ? t : null, keywords.includes(t) ? "EXACT" : "BROAD", `SP - ${p.asin}`, impressions, clicks, spend, purchases, round2(purchases * unitPrice), purchases, round2(5 + hash(`${t}top`) * 30));
          cost += spend;
          clicksTotal += clicks;
          impressionsTotal += impressions;
          salesTotal += purchases * unitPrice;
          purchasesTotal += purchases;
        }
        prod.run(p.marketplace, date, p.asin, impressionsTotal, clicksTotal, round2(cost), purchasesTotal, round2(salesTotal), purchasesTotal);
      }
    }
  })();
}

/** Every table that can hold demo rows. */
export const DEMO_TABLES = [
  "rank_checks",
  "bsr_snapshots",
  "sales_traffic",
  "orders",
  "fee_events",
  "inventory_snapshots",
  "ads_search_terms",
  "ads_products",
  "ads_campaign_asins",
  "listing_snapshots",
  "listings",
  "sqp_weekly",
  "search_terms",
] as const;
