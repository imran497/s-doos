import "server-only";
import { connection } from "next/server";
import { fifo, landedUnitCost, type ShipmentStatus } from "./cogs";
import { db } from "./db";

// Read side of the Shipments page: every shipment with its lines, landed costs and how much of each
// line has sold (first-in, first-out), plus totals and a stock check against Amazon's count.

export type ProductOption = { asin: string; title: string; imageUrl: string | null };

export type ShipmentLine = {
  id: number;
  asin: string;
  title: string;
  imageUrl: string | null;
  qty: number;
  unitPrice: number;
  miscCharges: number;
  totalPaid: number;
  notes: string;
  /** Share of the shipment's placement fee and other costs, per unit. */
  sharedPerUnit: number;
  landedUnitCost: number;
  sold: number;
  remaining: number;
};

export type Shipment = {
  id: number;
  ref: string;
  supplier: string;
  orderDate: string;
  status: ShipmentStatus;
  arrivedDate: string | null;
  placementFee: number;
  otherCosts: number;
  notes: string;
  units: number;
  /** Everything paid for the shipment: lines plus shared costs. */
  totalCost: number;
  lines: ShipmentLine[];
};

/** Products you can put on a shipment, one per ASIN. */
export function productOptions(): ProductOption[] {
  return (
    db
      .prepare(
        `SELECT asin, COALESCE(MAX(title), asin) title, MAX(image_url) image_url FROM products GROUP BY asin
         ORDER BY EXISTS (SELECT 1 FROM listings l WHERE l.asin = products.asin AND l.status = 'Active') DESC, title`,
      )
      .all() as { asin: string; title: string; image_url: string | null }[]
  ).map((p) => ({ asin: p.asin, title: p.title, imageUrl: p.image_url }));
}

export async function getShipments() {
  await connection();
  const products = new Map(productOptions().map((p) => [p.asin, p]));
  const shipments = db
    .prepare("SELECT * FROM shipments ORDER BY order_date DESC, id DESC")
    .all() as {
    id: number;
    ref: string;
    supplier: string;
    order_date: string;
    status: ShipmentStatus;
    arrived_date: string | null;
    placement_fee: number;
    other_costs: number;
    notes: string;
  }[];
  const items = db.prepare("SELECT * FROM shipment_items ORDER BY id").all() as {
    id: number;
    shipment_id: number;
    asin: string;
    qty: number;
    unit_price: number;
    misc_charges: number;
    total_paid: number;
    notes: string;
  }[];

  // Sold / remaining per line, from each ASIN's first-in, first-out match.
  const results = new Map([...new Set(items.map((i) => i.asin))].map((asin) => [asin, fifo(asin)]));
  const layerOf = (itemId: number, asin: string) => results.get(asin)?.layers.find((l) => l.itemId === itemId);

  const list: Shipment[] = shipments.map((s) => {
    const own = items.filter((i) => i.shipment_id === s.id);
    const units = own.reduce((n, i) => n + i.qty, 0);
    const shared = s.placement_fee + s.other_costs;
    return {
      id: s.id,
      ref: s.ref,
      supplier: s.supplier,
      orderDate: s.order_date,
      status: s.status,
      arrivedDate: s.arrived_date,
      placementFee: s.placement_fee,
      otherCosts: s.other_costs,
      notes: s.notes,
      units,
      totalCost: own.reduce((n, i) => n + i.total_paid, 0) + shared,
      lines: own.map((i) => {
        const layer = layerOf(i.id, i.asin);
        const product = products.get(i.asin);
        return {
          id: i.id,
          asin: i.asin,
          title: product?.title ?? i.asin,
          imageUrl: product?.imageUrl ?? null,
          qty: i.qty,
          unitPrice: i.unit_price,
          miscCharges: i.misc_charges,
          totalPaid: i.total_paid,
          notes: i.notes,
          sharedPerUnit: units ? Math.round((shared / units) * 100) / 100 : 0,
          landedUnitCost: landedUnitCost({ qty: i.qty, totalPaid: i.total_paid }, shared, units),
          sold: layer?.sold ?? 0,
          remaining: layer?.remaining ?? i.qty,
        };
      }),
    };
  });

  // Value at cost: what's at Amazon (unsold units of arrived shipments) and what's paid but not there yet.
  const atAmazon = list
    .filter((s) => s.status === "arrived")
    .reduce((n, s) => n + s.lines.reduce((m, l) => m + l.remaining * l.landedUnitCost, 0), 0);
  const notArrived = list.filter((s) => s.status !== "arrived");
  const summary = {
    atAmazon,
    paidNotArrived: notArrived.reduce((n, s) => n + s.totalCost, 0),
    unitsOnTheWay: notArrived.reduce((n, s) => n + s.units, 0),
    invested: list.reduce((n, s) => n + s.totalCost, 0),
  };

  // Stock check: units your shipments say should be at Amazon vs what Amazon reports.
  const stock = [...results.entries()].map(([asin, r]) => {
    const expected = r.layers.filter((l) => l.status === "arrived").reduce((n, l) => n + l.remaining, 0);
    const amazon = db
      .prepare(
        `SELECT SUM(fulfillable + reserved) units FROM inventory_snapshots i
         WHERE asin = ? AND date = (SELECT MAX(date) FROM inventory_snapshots WHERE marketplace = i.marketplace)
         GROUP BY marketplace ORDER BY units DESC LIMIT 1`,
      )
      .get(asin) as { units: number } | undefined;
    return {
      asin,
      title: products.get(asin)?.title ?? asin,
      imageUrl: products.get(asin)?.imageUrl ?? null,
      received: r.layers.filter((l) => l.status === "arrived").reduce((n, l) => n + l.qty, 0),
      sold: r.layers.reduce((n, l) => n + l.sold, 0) + r.uncovered,
      untracked: r.untracked,
      expected,
      amazon: amazon?.units ?? null,
    };
  });

  const nextRef = (() => {
    const numbers = list.map((s) => s.ref.match(/^(.*?)(\d+)$/)).filter((m): m is RegExpMatchArray => Boolean(m));
    if (!numbers.length) return "SH-001";
    const top = numbers.sort((a, b) => Number(b[2]) - Number(a[2]))[0];
    return `${top[1]}${String(Number(top[2]) + 1).padStart(top[2].length, "0")}`;
  })();

  return { shipments: list, summary, stock, nextRef, products: [...products.values()] };
}

export type ShipmentsData = Awaited<ReturnType<typeof getShipments>>;
