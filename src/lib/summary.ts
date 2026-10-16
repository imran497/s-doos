import "server-only";
import { connection } from "next/server";
import { fifo } from "./cogs";
import { db } from "./db";
import { AMAZON_CATEGORIES } from "./expenses-meta";
import { getShipments } from "./shipments";

// The whole business since the first shipment, laid out like the KidBees sheet's SUMMARY tab:
//   money out (inventory, Amazon charges, ads, tools, other costs), money back (Amazon payouts),
//   and the result (profit on units sold, overhead, operating profit, cash position), then per product.
// All amounts in USD. Sales in other currencies (Canada, Mexico) are counted in units but left out of money.

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Amazon order money that becomes your payout: sales, promotions, Amazon's per-order fees and refunds. */
const PAYOUT_KINDS = ["sale", "promotion", "fee", "refund"];

export async function getSummary() {
  await connection();
  const ships = await getShipments();

  // ---- Money out ----
  const arrived = ships.shipments.filter((s) => s.status === "arrived");
  const inventoryArrived = arrived.reduce((n, s) => n + s.totalCost, 0);
  const inventoryOnTheWay = ships.summary.paidNotArrived;

  const counted = new Set(AMAZON_CATEGORIES.filter((c) => c.treatment === "cost").map((c) => c.key));
  const expense = (where: string, ...args: unknown[]) =>
    (db.prepare(`SELECT COALESCE(SUM(amount), 0) s FROM expenses WHERE currency = 'USD' AND ${where}`).get(...args) as { s: number }).s;
  const amazonKeys = [...counted].filter((k) => k.startsWith("amazon_"));
  const amazonCharges = expense(`category IN (${amazonKeys.map(() => "?").join(",")})`, ...amazonKeys);
  const advertising = expense("category = 'advertising'");
  const tools = expense("category = 'tools'");
  const ownKeys = (db.prepare("SELECT key FROM expense_categories WHERE key != 'tools'").all() as { key: string }[]).map((r) => r.key);
  const otherCosts = ownKeys.length ? expense(`category IN (${ownKeys.map(() => "?").join(",")})`, ...ownKeys) : 0;
  const overhead = amazonCharges + advertising + tools + otherCosts;
  const totalInvested = inventoryArrived + inventoryOnTheWay + overhead;

  // ---- Money back ----
  // Per order: what Amazon actually settled when it has (Finances), else an estimate from the sell price and
  // Amazon's fee estimate (Amazon holds payouts until about a week after delivery). A unit is free (Vine,
  // replacement) when its promotion cancels the price.
  const orders = db
    .prepare(
      `SELECT order_id, asin, qty, item_price, promo_discount, currency FROM orders WHERE status != 'Cancelled'`,
    )
    .all() as { order_id: string; asin: string; qty: number; item_price: number; promo_discount: number; currency: string }[];
  const settled = new Map<string, number>();
  const orphans = new Map<string, number>();
  const known = new Set(orders.map((o) => o.order_id));
  for (const f of db
    .prepare(
      `SELECT order_id, COALESCE(asin, (SELECT asin FROM sku_map WHERE sku = fee_events.sku)) asin, SUM(amount) total
       FROM fee_events WHERE currency = 'USD' AND kind IN (${PAYOUT_KINDS.map(() => "?").join(",")}) GROUP BY 1, 2`,
    )
    .all(...PAYOUT_KINDS) as { order_id: string | null; asin: string | null; total: number }[]) {
    if (f.order_id && known.has(f.order_id)) settled.set(`${f.order_id}|${f.asin}`, f.total);
    else if (f.asin) orphans.set(f.asin, (orphans.get(f.asin) ?? 0) + f.total); // e.g. a refund for an older order
  }
  const feeEstimate = db.prepare(
    `SELECT COALESCE(sale_price, regular_price, price) price, referral_fee, fba_fee FROM listings WHERE asin = ? AND marketplace = 'US'
     ORDER BY status = 'Active' DESC LIMIT 1`,
  );
  type PerAsin = { units: number; paidUnits: number; settled: number; pending: number; paidPayout: number; pendingUnits: number };
  const perAsin = new Map<string, PerAsin>();
  for (const o of orders) {
    const a = perAsin.get(o.asin) ?? { units: 0, paidUnits: 0, settled: 0, pending: 0, paidPayout: 0, pendingUnits: 0 };
    perAsin.set(o.asin, a);
    a.units += o.qty;
    const net = o.item_price - o.promo_discount;
    const paid = net > 0.01;
    if (paid) a.paidUnits += o.qty;
    if (o.currency && o.currency !== "USD") continue; // units only
    const actual = settled.get(`${o.order_id}|${o.asin}`);
    let amount: number;
    if (actual != null) {
      amount = actual;
      a.settled += actual;
    } else {
      const f = feeEstimate.get(o.asin) as { price: number | null; referral_fee: number | null; fba_fee: number | null } | undefined;
      const referralRate = f?.price && f.referral_fee != null ? f.referral_fee / f.price : 0.15;
      amount = Math.max(0, net) * (1 - referralRate) - (f?.fba_fee ?? 0) * o.qty;
      a.pending += amount;
      a.pendingUnits += o.qty;
    }
    if (paid) a.paidPayout += amount;
  }
  for (const [asin, total] of orphans) {
    const a = perAsin.get(asin) ?? { units: 0, paidUnits: 0, settled: 0, pending: 0, paidPayout: 0, pendingUnits: 0 };
    perAsin.set(asin, a);
    a.settled += total;
  }
  const all = [...perAsin.values()];
  const payoutSettled = all.reduce((n, a) => n + a.settled, 0);
  const payoutPending = all.reduce((n, a) => n + a.pending, 0);
  const payout = payoutSettled + payoutPending;
  const unitsSold = all.reduce((n, a) => n + a.units, 0);
  const freeUnits = all.reduce((n, a) => n + a.units - a.paidUnits, 0);
  const pendingUnits = all.reduce((n, a) => n + a.pendingUnits, 0);
  const otherCurrencies = [...new Set(orders.filter((o) => o.currency && o.currency !== "USD").map((o) => o.currency))];
  const payoutSince = (db.prepare("SELECT MIN(posted_date) d FROM fee_events WHERE kind = 'sale'").get() as { d: string | null }).d;
  const ordersSince = (db.prepare("SELECT MIN(purchase_date) d FROM orders").get() as { d: string | null }).d?.slice(0, 10) ?? null;
  // How current the numbers are.
  const freshness = {
    newestOrder: (db.prepare("SELECT MAX(purchase_date) d FROM orders").get() as { d: string | null }).d,
    ordersSynced: (db.prepare("SELECT MAX(updated_at) t FROM report_requests WHERE kind = 'orders' AND status = 'done'").get() as { t: string | null }).t,
    latestPayout: (db.prepare("SELECT MAX(posted_date) d FROM fee_events WHERE kind = 'sale'").get() as { d: string | null }).d,
  };

  // ---- Per product ----
  const asins = [...new Set([...ships.stock.map((s) => s.asin), ...perAsin.keys()])];
  const info = new Map(ships.products.map((p) => [p.asin, p]));
  const listing = db.prepare(
    `SELECT COALESCE(sale_price, regular_price, price) price, total_fee FROM listings WHERE asin = ? AND marketplace = 'US'
     ORDER BY status = 'Active' DESC LIMIT 1`,
  );
  let cogsSold = 0;
  const products = asins
    .map((asin) => {
      const result = fifo(asin);
      const sold = perAsin.get(asin);
      const productPayout = sold ? sold.settled + sold.pending : 0;
      const cogs = result.sales.reduce((n, s) => n + s.cost, 0);
      cogsSold += cogs;
      const received = result.layers.reduce((n, l) => n + l.qty, 0);
      const inStock = result.layers.reduce((n, l) => n + l.remaining, 0);
      const nextCost = result.layers.find((l) => l.remaining > 0)?.unitCost ?? result.layers.at(-1)?.unitCost ?? null;
      const paidUnits = sold?.paidUnits ?? 0;
      // Actual payout per paid unit when there are sales; otherwise today's price minus Amazon's fee estimate.
      const l = listing.get(asin) as { price: number | null; total_fee: number | null } | undefined;
      const payoutPerUnit = paidUnits > 0 && sold ? sold.paidPayout / paidUnits : l?.price != null && l.total_fee != null ? l.price - l.total_fee : null;
      const profitPerUnit = payoutPerUnit != null && nextCost != null ? payoutPerUnit - nextCost : null;
      return {
        asin,
        title: info.get(asin)?.title ?? asin,
        imageUrl: info.get(asin)?.imageUrl ?? null,
        unitsSold: sold?.units ?? 0,
        paidUnits,
        payout: round2(productPayout),
        cogs: round2(cogs),
        payoutPerUnit,
        profitPerUnit,
        unitCost: nextCost,
        received,
        inStock,
        basedOn: paidUnits > 0 ? ("sales" as const) : ("estimate" as const),
      };
    })
    .filter((p) => p.received > 0 || p.unitsSold > 0)
    .sort((a, b) => b.unitsSold - a.unitsSold || b.received - a.received);

  // ---- Result ----
  const profitOnSold = payout - cogsSold;
  const operating = profitOnSold - overhead;
  const unsoldInventory = inventoryArrived - cogsSold;
  const netCash = payout - inventoryArrived - overhead;
  const netCashWithTransit = netCash - inventoryOnTheWay;

  const unitsNeeded = (shortfall: number, perUnit: number | null) => {
    if (shortfall >= 0) return 0;
    if (perUnit == null || perUnit <= 0) return null;
    return Math.ceil(-shortfall / perUnit);
  };

  return {
    moneyOut: { inventoryArrived, inventoryOnTheWay, amazonCharges, advertising, tools, otherCosts, totalInvested },
    moneyBack: { unitsSold, freeUnits, payout, payoutSettled, payoutPending, pendingUnits },
    result: { cogsSold, profitOnSold, overhead, operating, unsoldInventory, netCash, netCashWithTransit },
    products: products.map((p) => ({
      ...p,
      toCoverOperating: unitsNeeded(operating, p.profitPerUnit),
      toRecoverInvestment: unitsNeeded(netCashWithTransit, p.payoutPerUnit),
    })),
    coverage: { ordersSince, payoutSince, otherCurrencies, ...freshness },
  };
}

export type Summary = Awaited<ReturnType<typeof getSummary>>;
