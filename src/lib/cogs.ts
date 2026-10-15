import { landedUnitCost, type ShipmentStatus } from "./cogs-math";
import { db } from "./db";

// Cost of goods from the shipments you enter (Shipments page). Same arithmetic as the KidBees sheet:
//   cost per unit = round(total paid ÷ qty) + round(shared costs ÷ units in the whole shipment)
// where shared costs are the Amazon placement fee plus any other shipment-wide cost. Units sold are
// matched to shipments first-in, first-out: arrived shipments by arrival date, then ones still on the way.

export { defaultTotalPaid, landedUnitCost, SHIPMENT_STATUSES, type ShipmentStatus } from "./cogs-math";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type CostLayer = {
  itemId: number;
  shipmentId: number;
  ref: string;
  status: ShipmentStatus;
  date: string;
  qty: number;
  unitCost: number;
  /** Filled in by fifo(). */
  sold: number;
  remaining: number;
};

/** An ASIN's shipment lines in the order their units get sold. */
export function costLayers(asin: string): CostLayer[] {
  const rows = db
    .prepare(
      `SELECT i.id, i.shipment_id, i.qty, i.total_paid, s.ref, s.status, s.order_date, s.arrived_date,
         s.placement_fee + s.other_costs shared,
         (SELECT SUM(qty) FROM shipment_items WHERE shipment_id = s.id) units
       FROM shipment_items i JOIN shipments s ON s.id = i.shipment_id
       WHERE i.asin = ?
       ORDER BY s.status != 'arrived', COALESCE(s.arrived_date, s.order_date), s.order_date, i.id`,
    )
    .all(asin) as {
    id: number;
    shipment_id: number;
    qty: number;
    total_paid: number;
    ref: string;
    status: ShipmentStatus;
    order_date: string;
    arrived_date: string | null;
    shared: number;
    units: number;
  }[];
  return rows.map((r) => ({
    itemId: r.id,
    shipmentId: r.shipment_id,
    ref: r.ref,
    status: r.status,
    date: r.arrived_date ?? r.order_date,
    qty: r.qty,
    unitCost: landedUnitCost({ qty: r.qty, totalPaid: r.total_paid }, r.shared, r.units),
    sold: 0,
    remaining: r.qty,
  }));
}

export type FifoResult = {
  layers: CostLayer[];
  /** Cost of each order (or the earlier-sales block), in date order. `at` is a timestamp. */
  sales: { at: number; units: number; cost: number; estimated: boolean }[];
  /** Units that left stock before SellerDoos's order history starts (or were removed or damaged). */
  untracked: number;
  /** Units sold beyond what shipments cover; costed at the last known cost. */
  uncovered: number;
};

/**
 * Matches the ASIN's sales to its shipments, first-in, first-out. Sales come from orders in every
 * marketplace (FBA stock is shared across North America), cancelled ones left out. Stock that has left
 * arrived shipments without a matching order (sales before the order history, removals, damage) is
 * worked out from Amazon's own inventory count and taken first.
 */
export function fifo(asin: string): FifoResult {
  const layers = costLayers(asin);
  const orders = (
    db
      .prepare("SELECT purchase_date, SUM(qty) qty FROM orders WHERE asin = ? AND status != 'Cancelled' GROUP BY order_id ORDER BY purchase_date")
      .all(asin) as { purchase_date: string; qty: number }[]
  ).map((o) => ({ at: Date.parse(o.purchase_date), units: o.qty }));

  // Amazon's latest count (stock is pooled across a region, so take the largest marketplace view, not a sum).
  const count = db
    .prepare(
      `SELECT SUM(fulfillable + reserved + unfulfillable) stocked, SUM(inbound) inbound FROM inventory_snapshots i
       WHERE asin = ? AND date = (SELECT MAX(date) FROM inventory_snapshots WHERE marketplace = i.marketplace)
       GROUP BY marketplace ORDER BY stocked + inbound DESC LIMIT 1`,
    )
    .get(asin) as { stocked: number; inbound: number } | undefined;
  const arrived = layers.filter((l) => l.status === "arrived").reduce((s, l) => s + l.qty, 0);
  const onTheWay = layers.filter((l) => l.status !== "arrived").reduce((s, l) => s + l.qty, 0);
  const tracked = orders.reduce((s, o) => s + o.units, 0);
  // Inbound units belong to shipments not marked arrived yet, unless there are more of them than that.
  const onHand = count ? count.stocked + Math.max(0, count.inbound - onTheWay) : null;
  const untracked = onHand == null ? 0 : Math.max(0, arrived - tracked - onHand);

  const sales: FifoResult["sales"] = [];
  let uncovered = 0;
  const take = (units: number) => {
    let cost = 0;
    let estimated = false;
    let left = units;
    for (const layer of layers) {
      if (!left) break;
      const n = Math.min(left, layer.remaining);
      if (!n) continue;
      layer.remaining -= n;
      layer.sold += n;
      cost += n * layer.unitCost;
      left -= n;
    }
    if (left) {
      // More sold than shipments cover: use the latest cost so profit isn't overstated.
      uncovered += left;
      cost += left * (layers.at(-1)?.unitCost ?? 0);
      estimated = true;
    }
    return { cost: round2(cost), estimated: estimated || !layers.length };
  };

  if (untracked) sales.push({ at: -Infinity, units: untracked, ...take(untracked) });
  for (const o of orders) sales.push({ at: o.at, units: o.units, ...take(o.units) });
  return { layers, sales, untracked, uncovered };
}

/** Cost of one unit sold next: the first shipment with stock left, else the latest one. */
export function currentUnitCost(result: FifoResult) {
  const next = result.layers.find((l) => l.remaining > 0) ?? result.layers.at(-1);
  return next ? { unitCost: next.unitCost, ref: next.ref } : null;
}

/** Cost of goods for orders placed in [from, to) (timestamps), and the units it covers. */
export function cogsBetween(result: FifoResult, from: number, to: number) {
  const inRange = result.sales.filter((s) => s.at >= from && s.at < to);
  return {
    units: inRange.reduce((s, x) => s + x.units, 0),
    cost: round2(inRange.reduce((s, x) => s + x.cost, 0)),
    estimated: inRange.some((x) => x.estimated),
  };
}

/** True when the ASIN has any shipment lines (otherwise the legacy manual unit cost applies). */
export const hasShipments = (asin: string) => Boolean(db.prepare("SELECT 1 FROM shipment_items WHERE asin = ? LIMIT 1").get(asin));
