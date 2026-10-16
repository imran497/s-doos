import { strFromU8, unzipSync } from "fflate";
import { db } from "./db";
import { rememberCampaignAsin } from "./jobs/reports";
import type { MarketplaceCode } from "./marketplaces";

// Imports Sponsored Products reports downloaded from the Amazon Ads console (Measurement & reporting →
// Sponsored ads reports), for when the Ads API isn't connected. Two daily reports are understood:
//   • Advertised product report → ads_products (spend, sales, orders per ASIN per day)
//   • Search term report        → ads_search_terms (what shoppers typed)
// Both .xlsx and .csv exports work. Rows land in the same tables the Ads API fills (source 'upload'), so
// the Dashboard, Products and Research pages use them without changes.

export type AdsReportKind = "products" | "searchTerms";
export type AdsUploadResult = { file: string; kind: AdsReportKind; rows: number; days: number; from: string; to: string; spend: number };

// ---- Reading the file ----

/** Rows of the first sheet (xlsx) or the CSV, as arrays of cell text. */
export function readTable(bytes: Uint8Array, filename: string): string[][] {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK": xlsx is a zip
  if (isZip || /\.xlsx$/i.test(filename)) return readXlsx(bytes);
  return readCsv(strFromU8(bytes).replace(/^﻿/, ""));
}

function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.filter((r) => r.some((v) => v.trim()));
}

const unescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");

function readXlsx(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes, { filter: (f) => f.name === "xl/sharedStrings.xml" || f.name === "xl/workbook.xml" || f.name.startsWith("xl/worksheets/") || f.name === "xl/_rels/workbook.xml.rels" });
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : "");
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  // The first sheet in the workbook.
  const rid = text("xl/workbook.xml").match(/<sheet [^>]*r:id="(rId\d+)"/)?.[1];
  const target = rid && [...text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship ([^>]*)\/>/g)].map((m) => m[1]).find((a) => a.includes(`Id="${rid}"`))?.match(/Target="([^"]+)"/)?.[1];
  const sheetName = target ? `xl/${target.replace(/^\/?xl\//, "")}` : Object.keys(files).find((f) => f.startsWith("xl/worksheets/sheet"));
  if (!sheetName || !files[sheetName]) throw new Error("No sheet found in this file");

  const colIndex = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const rows: string[][] = [];
  for (const r of text(sheetName).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = c[1].match(/r="([A-Z]+\d+)"/)?.[1];
      if (!ref) continue;
      const type = c[1].match(/\bt="(\w+)"/)?.[1];
      const v = c[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const inline = c[2]?.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      row[colIndex(ref)] = type === "s" ? (shared[Number(v)] ?? "") : type === "inlineStr" ? unescape(inline ?? "") : unescape(v ?? "");
    }
    rows.push(Array.from(row, (x) => x ?? ""));
  }
  return rows.filter((r) => r.some((v) => v.trim()));
}

// ---- Understanding the columns ----

const norm = (h: string) => h.toLowerCase().replace(/\(#\)|\(\$\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const num = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(/[$,%\s]|[A-Z]{3}/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** "2026-10-14", "Oct 14, 2026", "10/14/2026" or an Excel day number → "2026-10-14". */
function day(v: string | undefined): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4,5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86_400_000).toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function columns(header: string[]) {
  const names = header.map(norm);
  const find = (...tests: ((n: string) => boolean)[]) => {
    for (const t of tests) {
      const i = names.findIndex(t);
      if (i >= 0) return i;
    }
    return -1;
  };
  return {
    date: find((n) => n === "date", (n) => n === "start date"),
    endDate: find((n) => n === "end date"),
    asin: find((n) => n === "advertised asin"),
    searchTerm: find((n) => n === "customer search term"),
    targeting: find((n) => n === "targeting", (n) => n === "keyword"),
    matchType: find((n) => n === "match type"),
    campaign: find((n) => n === "campaign name"),
    adGroup: find((n) => n === "ad group name"),
    impressions: find((n) => n === "impressions"),
    clicks: find((n) => n === "clicks"),
    spend: find((n) => n === "spend", (n) => n === "cost"),
    sales: find((n) => /^7 day total sales/.test(n), (n) => /^14 day total sales/.test(n), (n) => /total sales/.test(n), (n) => n === "sales"),
    orders: find((n) => /^7 day total orders/.test(n), (n) => /^14 day total orders/.test(n), (n) => /total orders/.test(n), (n) => n === "orders"),
    units: find((n) => /^7 day total units/.test(n), (n) => /^14 day total units/.test(n), (n) => /total units/.test(n), (n) => n === "units"),
  };
}

// ---- Importing ----

/** Reads one downloaded report and stores it, replacing the days it covers. */
export function importAdsReport(bytes: Uint8Array, filename: string, marketplace: MarketplaceCode): AdsUploadResult {
  const table = readTable(bytes, filename);
  // Some exports have a title line above the header: use the first row that looks like a header.
  const headerAt = table.findIndex((r) => r.map(norm).includes("impressions"));
  if (headerAt < 0) throw new Error(`${filename}: no Impressions column. Is this a Sponsored Products report?`);
  const col = columns(table[headerAt]);
  const kind: AdsReportKind | null = col.searchTerm >= 0 ? "searchTerms" : col.asin >= 0 ? "products" : null;
  if (!kind) throw new Error(`${filename}: expected an "Advertised product" or "Search term" report.`);
  if (col.date < 0) throw new Error(`${filename}: no Date column. Choose "Daily" as the time unit when creating the report.`);
  if (col.spend < 0 || col.clicks < 0) throw new Error(`${filename}: missing Spend or Clicks columns.`);

  const rows = table.slice(headerAt + 1).map((r) => ({ r, date: day(r[col.date]) })).filter((x) => x.date);
  if (col.endDate >= 0 && rows.some((x) => day(x.r[col.endDate]) !== x.date)) {
    throw new Error(`${filename}: this is a summary over several days. Re-create it with time unit "Daily".`);
  }
  if (!rows.length) throw new Error(`${filename}: no rows with a date.`);
  const dates = rows.map((x) => x.date!).sort();
  const [from, to] = [dates[0], dates.at(-1)!];
  const v = (r: string[], i: number) => (i >= 0 ? r[i] : "");

  db.transaction(() => {
    // Uploaded data replaces sample data, and re-uploading the same days replaces them instead of adding up.
    const table = kind === "products" ? "ads_products" : "ads_search_terms";
    db.prepare(`DELETE FROM ${table} WHERE marketplace = ? AND source = 'demo'`).run(marketplace);
    db.prepare("DELETE FROM ads_campaign_asins WHERE marketplace = ? AND source = 'demo'").run(marketplace);
    db.prepare(`DELETE FROM ${table} WHERE marketplace = ? AND date BETWEEN ? AND ? AND source = 'upload'`).run(marketplace, from, to);

    if (kind === "products") {
      // Several campaigns and SKUs can advertise one ASIN on a day: add them up.
      const save = db.prepare(`
        INSERT INTO ads_products (marketplace, date, asin, impressions, clicks, cost, purchases, sales, units, source)
        VALUES (@m, @date, @asin, @impressions, @clicks, @cost, @purchases, @sales, @units, 'upload')
        ON CONFLICT(marketplace, date, asin) DO UPDATE SET impressions = impressions + excluded.impressions, clicks = clicks + excluded.clicks,
          cost = cost + excluded.cost, purchases = purchases + excluded.purchases, sales = sales + excluded.sales, units = units + excluded.units,
          source = 'upload'`);
      for (const { r, date } of rows) {
        const asin = v(r, col.asin).trim().toUpperCase();
        if (!asin) continue;
        const campaign = v(r, col.campaign).trim();
        if (campaign) rememberCampaignAsin(marketplace, campaign, v(r, col.adGroup).trim() || null, asin, date!, "upload");
        save.run({
          m: marketplace,
          date,
          asin,
          impressions: num(v(r, col.impressions)),
          clicks: num(v(r, col.clicks)),
          cost: num(v(r, col.spend)),
          purchases: num(v(r, col.orders)),
          sales: num(v(r, col.sales)),
          units: num(v(r, col.units)),
        });
      }
    } else {
      const save = db.prepare(`
        INSERT INTO ads_search_terms (marketplace, date, search_term, keyword, match_type, campaign, ad_group, impressions, clicks, cost, purchases, sales, units, top_share, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'upload')`);
      for (const { r, date } of rows) {
        const term = v(r, col.searchTerm).trim();
        if (!term) continue;
        const match = v(r, col.matchType).trim().toUpperCase();
        save.run(marketplace, date, term, v(r, col.targeting).trim() || null, match && match !== "-" ? match : null, v(r, col.campaign).trim() || null,
          v(r, col.adGroup).trim() || null, num(v(r, col.impressions)), num(v(r, col.clicks)), num(v(r, col.spend)), num(v(r, col.orders)), num(v(r, col.sales)), num(v(r, col.units)));
      }
    }
  })();

  return {
    file: filename,
    kind,
    rows: rows.length,
    days: new Set(dates).size,
    from,
    to,
    spend: Math.round(rows.reduce((s, x) => s + num(v(x.r, col.spend)), 0) * 100) / 100,
  };
}

/** True once real ad data (API or uploaded reports) exists, so sample data stays away. */
export const hasRealAdsData = () =>
  Boolean(db.prepare("SELECT 1 FROM ads_products WHERE source != 'demo' UNION ALL SELECT 1 FROM ads_search_terms WHERE source != 'demo' LIMIT 1").get());
