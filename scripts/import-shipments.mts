// One-time import of shipments from the KidBees Google Sheet (downloaded as .xlsx), MAIN tab:
// the SHIPPING table (A:D, placement fee per order) and the INVENTORY table (F:V, one line per product).
//
//   npx tsx scripts/import-shipments.mts ~/Downloads/KidBees.xlsx [--dry-run]
//
// Uses DATABASE_PATH like the app. Shipments that already exist (same reference) are skipped, so it's
// safe to run twice. Prints each line's landed cost next to the sheet's COGS column to compare.
import { excelDate, readSheet } from "./xlsx.mts";

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error("Usage: npx tsx scripts/import-shipments.mts <KidBees.xlsx> [--dry-run]");
  process.exit(1);
}
const dryRun = flags.includes("--dry-run");

// The sheet's product ids → Amazon ASINs.
const ASINS: Record<string, string> = {
  MT_60PC: "B0GZ8LVLGR",
  MT_120PC: "B0H8RW47N2",
  ELMERS: "B08PC5R5BD",
  MASCARA: "B0DGPQ7NSN",
};

const { at, number } = readSheet(file, "MAIN");

// ---- Read the two tables ----
const placement = new Map<string, number>();
for (let r = 5; at("A", r); r++) placement.set(at("A", r), number("D", r));

type Line = { order: string; date: string; productId: string; available: boolean; qty: number; rate: number; misc: number; paid: number; sheetCogs: number };
const lines: Line[] = [];
for (let r = 5; at("G", r); r++) {
  lines.push({
    order: at("G", r),
    date: excelDate(number("F", r)),
    productId: at("I", r),
    available: at("K", r).toUpperCase() === "YES",
    qty: number("N", r),
    rate: number("O", r),
    misc: number("P", r),
    paid: number("R", r) || number("Q", r),
    sheetCogs: number("U", r),
  });
}

// ---- Write ----
const { db } = await import("../src/lib/db.ts");
const { landedUnitCost } = await import("../src/lib/cogs-math.ts");

const orders = [...new Set(lines.map((l) => l.order))];
for (const ref of orders) {
  const own = lines.filter((l) => l.order === ref);
  const unknown = own.filter((l) => !ASINS[l.productId]);
  if (unknown.length) {
    console.log(`✗ ${ref}: no ASIN for ${unknown.map((l) => l.productId).join(", ")}. Add it to ASINS in this script.`);
    continue;
  }
  const units = own.reduce((s, l) => s + l.qty, 0);
  const fee = placement.get(ref) ?? 0;
  const arrived = own.every((l) => l.available);
  const orderDate = own.map((l) => l.date).sort()[0];
  console.log(`${ref}: ${units} units, placement fee ${fee.toFixed(2)}, ${arrived ? "arrived" : "in transit"}, ordered ${orderDate}`);
  for (const l of own) {
    const cost = landedUnitCost({ qty: l.qty, totalPaid: l.paid }, fee, units);
    console.log(`   ${l.productId.padEnd(9)} ${String(l.qty).padStart(4)} × paid ${l.paid.toFixed(2).padStart(8)} → ${cost.toFixed(2)}/unit  (sheet ${l.sheetCogs.toFixed(2)})${Math.abs(cost - l.sheetCogs) > 0.005 ? "  ← differs" : ""}`);
  }
  if (dryRun) continue;
  if (db.prepare("SELECT 1 FROM shipments WHERE ref = ?").get(ref)) {
    console.log("   already in SellerDoos, skipped");
    continue;
  }
  db.transaction(() => {
    const id = db
      .prepare("INSERT INTO shipments (ref, supplier, order_date, status, arrived_date, placement_fee, other_costs, notes) VALUES (?, '', ?, ?, ?, ?, 0, 'Imported from the KidBees sheet')")
      .run(ref, orderDate, arrived ? "arrived" : "in_transit", arrived ? orderDate : null, fee).lastInsertRowid;
    const insert = db.prepare("INSERT INTO shipment_items (shipment_id, asin, qty, unit_price, misc_charges, total_paid) VALUES (?, ?, ?, ?, ?, ?)");
    for (const l of own) insert.run(id, ASINS[l.productId], l.qty, l.rate, l.misc, l.paid);
  })();
  console.log("   imported");
}
