import "server-only";
import { connection } from "next/server";
import { fifo, hasShipments } from "./cogs";
import { db } from "./db";

// Every sale of one product, newest first, the way the KidBees sheet's product tabs list them: price,
// promotion, what Amazon paid out (or will), the landed cost of the units, and the profit.

export type ProductOrder = {
  orderId: string;
  date: string;
  status: string;
  units: number;
  price: number;
  promotion: number;
  /** Price fully discounted (Vine, replacements). */
  free: boolean;
  currency: string;
  /** Settled by Amazon (sales, promotions, fees, refunds), or estimated while pending. */
  payout: number | null;
  payoutEstimated: boolean;
  cogs: number | null;
  profit: number | null;
};

const PAYOUT_KINDS = ["sale", "promotion", "fee", "refund"];

export async function getProductOrders(productId: number): Promise<ProductOrder[]> {
  await connection();
  const product = db.prepare("SELECT asin, marketplace, unit_cost FROM products WHERE id = ?").get(productId) as
    | { asin: string; marketplace: string; unit_cost: number | null }
    | undefined;
  if (!product) return [];

  const orders = db
    .prepare(
      `SELECT order_id, MIN(purchase_date) purchase_date, MAX(status) status, SUM(qty) qty, SUM(item_price) price,
         SUM(promo_discount) promo, MAX(currency) currency
       FROM orders WHERE asin = ? AND marketplace = ? GROUP BY order_id ORDER BY purchase_date DESC`,
    )
    .all(product.asin, product.marketplace) as { order_id: string; purchase_date: string; status: string; qty: number; price: number; promo: number; currency: string }[];

  // What Amazon settled per order, for this product's SKUs.
  const settled = new Map(
    (
      db
        .prepare(
          `SELECT order_id, SUM(amount) total FROM fee_events
           WHERE kind IN (${PAYOUT_KINDS.map(() => "?").join(",")}) AND order_id IS NOT NULL
             AND COALESCE(asin, (SELECT asin FROM sku_map WHERE sku = fee_events.sku)) = ?
           GROUP BY order_id`,
        )
        .all(...PAYOUT_KINDS, product.asin) as { order_id: string; total: number }[]
    ).map((r) => [r.order_id, r.total]),
  );

  // Amazon's fee estimate for pending orders: FBA fee per unit plus the referral fee as a share of price.
  const fees = db
    .prepare(
      `SELECT COALESCE(sale_price, regular_price, price) price, referral_fee, fba_fee FROM listings
       WHERE asin = ? AND marketplace = ? ORDER BY status = 'Active' DESC LIMIT 1`,
    )
    .get(product.asin, product.marketplace) as { price: number | null; referral_fee: number | null; fba_fee: number | null } | undefined;
  const referralRate = fees?.price && fees.referral_fee != null ? fees.referral_fee / fees.price : 0.15;

  // Cost of goods per order from shipments (first-in, first-out), else the manual unit cost.
  const cogsByOrder = new Map<string, number>();
  if (hasShipments(product.asin)) for (const s of fifo(product.asin).sales) if (s.orderId) cogsByOrder.set(s.orderId, s.cost);

  return orders.map((o) => {
    const cancelled = o.status === "Cancelled";
    const net = o.price - o.promo;
    const actual = settled.get(o.order_id);
    const estimate = cancelled ? 0 : Math.max(0, net) * (1 - referralRate) - (fees?.fba_fee ?? 0) * o.qty;
    const payout = actual ?? (o.currency && o.currency !== "USD" && !fees ? null : estimate);
    const cogs = cancelled ? 0 : (cogsByOrder.get(o.order_id) ?? (product.unit_cost != null ? product.unit_cost * o.qty : null));
    return {
      orderId: o.order_id,
      date: o.purchase_date,
      status: o.status,
      units: o.qty,
      price: o.price,
      promotion: o.promo,
      free: !cancelled && o.price > 0 && net <= 0.01,
      currency: o.currency || "USD",
      payout: payout == null ? null : Math.round(payout * 100) / 100,
      payoutEstimated: actual == null && !cancelled,
      cogs: cogs == null ? null : Math.round(cogs * 100) / 100,
      profit: payout != null && cogs != null ? Math.round((payout - cogs) * 100) / 100 : null,
    };
  });
}
