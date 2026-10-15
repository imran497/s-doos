// One-time import of misc charges from the KidBees sheet (downloaded as .xlsx):
//   MAIN X:Z  TOOL SUBSCRIPTIONS → Tools & subscriptions
//   MAIN AB:AD MISC              → Samples / Trademark & legal / UPC codes / Inspections / Prep & supplies / Other
//   AMAZON_MISC rows of type ADS → Advertising (billed to your card, so SP-API doesn't have them)
// Other AMAZON_MISC rows (subscription, storage, coupons, negative balance) are skipped: those come from
// Amazon automatically.
//
//   npx tsx scripts/import-expenses.mts ~/Downloads/KidBees.xlsx [--dry-run]
//
// Safe to run twice: each sheet row is imported once.
import { excelDate, readSheet } from "./xlsx.mts";

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error("Usage: npx tsx scripts/import-expenses.mts <KidBees.xlsx> [--dry-run]");
  process.exit(1);
}
const dryRun = flags.includes("--dry-run");

const miscCategory = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes("sample")) return "samples";
  if (n.includes("trademark")) return "trademark";
  if (n.includes("upc")) return "upc";
  if (n.includes("tic") || n.includes("inspection") || n.includes("qima") || n.includes("hqts")) return "inspections";
  if (n.includes("prep")) return "prep";
  return "other";
};

type Row = { externalId: string; date: string; category: string; description: string; amount: number };
const rows: Row[] = [];

const main = readSheet(file, "MAIN");
for (let r = 5; main.at("Y", r); r++) {
  rows.push({ externalId: `sheet:MAIN!X${r}`, date: excelDate(main.number("X", r)), category: "tools", description: main.at("Y", r), amount: main.number("Z", r) });
}
for (let r = 5; main.at("AC", r); r++) {
  const name = main.at("AC", r);
  rows.push({ externalId: `sheet:MAIN!AB${r}`, date: excelDate(main.number("AB", r)), category: miscCategory(name), description: name, amount: main.number("AD", r) });
}
const amazon = readSheet(file, "AMAZON_MISC");
let skipped = 0;
for (let r = 4; amazon.at("B", r); r++) {
  if (amazon.at("B", r).toUpperCase() !== "ADS") {
    skipped++;
    continue;
  }
  rows.push({ externalId: `sheet:AMAZON_MISC!A${r}`, date: excelDate(amazon.number("A", r)), category: "advertising", description: "Amazon ads", amount: amazon.number("C", r) });
}

const { db } = await import("../src/lib/db.ts");
const insert = db.prepare(
  "INSERT INTO expenses (date, category, description, amount, notes, source, external_id) VALUES (?, ?, ?, ?, '', 'sheet', ?) ON CONFLICT(external_id) DO NOTHING",
);
let added = 0;
const totals = new Map<string, number>();
for (const r of rows) {
  totals.set(r.category, (totals.get(r.category) ?? 0) + r.amount);
  if (!dryRun && r.amount > 0) added += insert.run(r.date, r.category, r.description, r.amount, r.externalId).changes;
}
for (const [c, t] of totals) console.log(`${c.padEnd(12)} ${t.toFixed(2).padStart(10)}`);
console.log(`${rows.length} rows read, ${added} added${dryRun ? " (dry run)" : ""}; ${skipped} Amazon rows skipped (they come from Amazon automatically)`);
