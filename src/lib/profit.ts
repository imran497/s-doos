import { cogsBetween, currentUnitCost, fifo, hasShipments, type FifoResult } from "./cogs";
import { db } from "./db";

// Profit per ASIN from what Amazon actually posted (Finances API), minus ad spend and your cost of goods.
//   profit = sales + promotions + Amazon fees + service fees + refunds + adjustments − ad spend − cost of goods
// Cost of goods comes from your shipments (first-in, first-out, see cogs.ts); a product without shipments
// falls back to the unit cost entered on the product.
// Amounts in fee_events are signed (fees and refunds are negative). Tax is collected and remitted by
// Amazon in most marketplaces, so it's excluded.

export type ProfitBreakdown = {
  sales: number;
  promotions: number;
  amazonFees: number;
  refunds: number;
  adjustments: number;
  adSpend: number;
  units: number;
  /** null when the product has neither shipments nor a unit cost. */
  cogs: number | null;
  /** Where the cost of goods came from. */
  cogsSource: "shipments" | "unit_cost" | null;
  profit: number;
  /** Profit as a share of sales, 0–1. */
  margin: number | null;
  currency: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Per-unit cost of goods for a range of dates: shipments when entered, else the manual unit cost. */
type CostSource = { kind: "shipments"; result: FifoResult } | { kind: "unit_cost"; unitCost: number } | null;

function costSource(asin: string, unitCost: number | null): CostSource {
  if (hasShipments(asin)) return { kind: "shipments", result: fifo(asin) };
  return unitCost == null ? null : { kind: "unit_cost", unitCost };
}

const dayStart = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).getTime();
};

/** Average cost of the units ordered between the dates; the next unit's cost when nothing was ordered. */
function unitCostFor(source: CostSource, from: string, to: string): number | null {
  if (!source) return null;
  if (source.kind === "unit_cost") return source.unitCost;
  const range = cogsBetween(source.result, dayStart(from), dayStart(to) + 86_400_000);
  return range.units ? range.cost / range.units : (currentUnitCost(source.result)?.unitCost ?? null);
}

function breakdown(
  money: { kind: string; total: number; units: number }[],
  adSpend: number,
  unitCost: number | null,
  currency: string,
  cogsSource: ProfitBreakdown["cogsSource"] = null,
): ProfitBreakdown {
  const sum = (...kinds: string[]) => money.filter((m) => kinds.includes(m.kind)).reduce((s, m) => s + m.total, 0);
  const units = money.filter((m) => m.kind === "sale").reduce((s, m) => s + m.units, 0);
  const sales = sum("sale");
  const promotions = sum("promotion");
  const amazonFees = sum("fee", "service_fee");
  const refunds = sum("refund");
  const adjustments = sum("adjustment");
  const cogs = unitCost == null ? null : units * unitCost;
  const profit = sales + promotions + amazonFees + refunds + adjustments - adSpend - (cogs ?? 0);
  return {
    sales: round2(sales),
    promotions: round2(promotions),
    amazonFees: round2(amazonFees),
    refunds: round2(refunds),
    adjustments: round2(adjustments),
    adSpend: round2(adSpend),
    units,
    cogs: cogs == null ? null : round2(cogs),
    cogsSource: cogs == null ? null : cogsSource,
    profit: round2(profit),
    margin: sales ? profit / sales : null,
    currency,
  };
}

const productRow = (productId: number) =>
  db.prepare("SELECT asin, marketplace, unit_cost FROM products WHERE id = ?").get(productId) as
    | { asin: string; marketplace: string; unit_cost: number | null }
    | undefined;

/** Profit for one product over posted dates [from, to]. */
export function productProfit(productId: number, from: string, to: string): ProfitBreakdown {
  const p = productRow(productId);
  if (!p) throw new Error("Product not found");
  const money = db
    .prepare(
      `SELECT kind, SUM(amount) total, SUM(qty) units FROM fee_events
       WHERE asin = ? AND marketplace = ? AND posted_date BETWEEN ? AND ? GROUP BY kind`,
    )
    .all(p.asin, p.marketplace, from, to) as { kind: string; total: number; units: number }[];
  const ads = db
    .prepare("SELECT COALESCE(SUM(cost), 0) s FROM ads_products WHERE asin = ? AND marketplace = ? AND date BETWEEN ? AND ?")
    .get(p.asin, p.marketplace, from, to) as { s: number };
  const currency = (db.prepare("SELECT currency FROM fee_events WHERE asin = ? AND currency != '' LIMIT 1").get(p.asin) as { currency: string } | undefined)?.currency ?? "";
  const source = costSource(p.asin, p.unit_cost);
  return breakdown(money, ads.s, unitCostFor(source, from, to), currency, source?.kind ?? null);
}

/** Daily profit for a product, for charts. Days with no posted money are zero. */
export function dailyProfit(productId: number, dates: string[]) {
  const p = productRow(productId);
  if (!p || !dates.length) return [];
  const money = db
    .prepare(
      `SELECT posted_date d, kind, SUM(amount) total, SUM(qty) units FROM fee_events
       WHERE asin = ? AND marketplace = ? AND posted_date BETWEEN ? AND ? GROUP BY posted_date, kind`,
    )
    .all(p.asin, p.marketplace, dates[0], dates.at(-1)) as { d: string; kind: string; total: number; units: number }[];
  const ads = db
    .prepare("SELECT date d, SUM(cost) cost FROM ads_products WHERE asin = ? AND marketplace = ? AND date BETWEEN ? AND ? GROUP BY date")
    .all(p.asin, p.marketplace, dates[0], dates.at(-1)) as { d: string; cost: number }[];
  const source = costSource(p.asin, p.unit_cost);
  return dates.map((date) => ({
    date,
    ...breakdown(
      money.filter((m) => m.d === date),
      ads.find((a) => a.d === date)?.cost ?? 0,
      unitCostFor(source, date, date),
      "",
      source?.kind ?? null,
    ),
  }));
}
