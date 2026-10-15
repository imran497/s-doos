"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { clearCredentials, CREDENTIALS, setCredential, type CredentialGroup, type CredentialName } from "@/lib/credentials";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { acknowledgeSecurityEvents, recordSecurityEvent } from "@/lib/security";
import { isAsin, isMarketplace } from "@/lib/marketplaces";
import { saveSettings } from "@/lib/settings";
import { isAdsConfigured } from "@/lib/amazon/ads";
import { getCatalogItem, isSpApiConfigured } from "@/lib/amazon/spapi";
import { accountMarketplaces, checkProduct, clearDemo, logRun, pruneDemo, refreshDemo, refreshSearchVolumes, runDaily, sellerMarketplaces, syncAmazon, syncExpenses } from "@/lib/jobs";
import { marketplaces } from "@/lib/marketplaces";

// SellerDoos is a single-user local tool with no login. Server Actions are reachable by any
// POST to the server, so don't expose it to the internet without adding authentication.

export type ActionState = { error?: string; message?: string } | undefined;

const parseKeywords = (text: string) =>
  [...new Set(text.split(/[\n,]/).map((k) => k.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean))].slice(0, 500);

function insertKeywords(productId: number, keywords: string[]) {
  const insert = db.prepare("INSERT OR IGNORE INTO keywords (product_id, keyword) VALUES (?, ?)");
  let added = 0;
  db.transaction(() => {
    for (const k of keywords) added += insert.run(productId, k).changes;
  })();
  return added;
}

export async function addProduct(_: ActionState, form: FormData): Promise<ActionState> {
  await requireSession();
  const asin = String(form.get("asin") ?? "").trim().toUpperCase();
  const marketplace = String(form.get("marketplace") ?? "US");
  if (!isAsin(asin)) return { error: "An ASIN is 10 letters and numbers, like B0GZ8LVLGR." };
  if (!isMarketplace(marketplace)) return { error: "Pick a marketplace." };

  const existing = db.prepare("SELECT id FROM products WHERE asin = ? AND marketplace = ?").get(asin, marketplace) as
    | { id: number }
    | undefined;
  const id =
    existing?.id ??
    Number(db.prepare("INSERT INTO products (asin, marketplace) VALUES (?, ?)").run(asin, marketplace).lastInsertRowid);
  insertKeywords(id, parseKeywords(String(form.get("keywords") ?? "")));
  await refreshSearchVolumes(id).catch(() => undefined);
  refreshDemo();

  if (!existing && isSpApiConfigured()) {
    // Fill in the title and image now; the daily check keeps them fresh.
    try {
      const item = await getCatalogItem(asin, marketplace);
      db.prepare("UPDATE products SET title = ?, image_url = ? WHERE id = ?").run(item.title ?? null, item.imageUrl ?? null, id);
    } catch {
      // Not fatal: the first rank check also picks up the title from search results.
    }
  }
  redirect(`/products/${id}`);
}

export async function deleteProduct(productId: number) {
  await requireSession();
  db.prepare("DELETE FROM products WHERE id = ?").run(productId);
  redirect("/products");
}

export async function addKeywords(productId: number, _: ActionState, form: FormData): Promise<ActionState> {
  await requireSession();
  const keywords = parseKeywords(String(form.get("keywords") ?? ""));
  if (!keywords.length) return { error: "Enter at least one keyword." };
  const added = insertKeywords(productId, keywords);
  if (added) await refreshSearchVolumes(productId).catch(() => undefined);
  refresh();
  return { message: added ? `Added ${added} keyword${added === 1 ? "" : "s"}. Click "Check now" to rank them.` : "Those keywords are already tracked." };
}

/** Starts tracking one keyword, e.g. a search query found in the SQP report. */
export async function trackKeyword(productId: number, keyword: string) {
  await requireSession();
  if (insertKeywords(productId, parseKeywords(keyword))) await refreshSearchVolumes(productId).catch(() => undefined);
  refresh();
}

export async function deleteKeywords(productId: number, keywordIds: number[]) {
  await requireSession();
  const remove = db.prepare("DELETE FROM keywords WHERE id = ? AND product_id = ?");
  db.transaction(() => keywordIds.forEach((id) => remove.run(id, productId)))();
  refresh();
}

export async function updateTags(keywordId: number, tags: string) {
  await requireSession();
  const clean = [...new Set(tags.split(",").map((t) => t.trim()).filter(Boolean))].join(", ");
  db.prepare("UPDATE keywords SET tags = ? WHERE id = ?").run(clean, keywordId);
  refresh();
}

export async function checkNow(productId: number, keywordIds?: number[]): Promise<ActionState> {
  await requireSession();
  try {
    const result = await logRun("manual", () => checkProduct(productId, keywordIds));
    if (!keywordIds) refreshDemo();
    refresh();
    const waiting = result.pending ? ` ${result.pending} still processing; they'll appear within a few minutes.` : "";
    if (result.errors.length) return { error: `Checked ${result.checked}, ${result.errors.length} failed: ${result.errors[0]}${waiting}` };
    return { message: `Checked ${result.checked} keyword${result.checked === 1 ? "" : "s"}.${waiting}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function runDailyNow(): Promise<ActionState> {
  await requireSession();
  try {
    const r = await runDaily();
    refresh();
    const waiting = r.pending ? ` ${r.pending} searches are still processing and will be collected automatically.` : "";
    return r.errors.length ? { error: r.errors[0] } : { message: `Checked ${r.checked} keywords.${waiting}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** Pulls inventory, finances, listings and any due reports from Amazon, waiting up to a minute for reports. */
export async function syncAmazonNow(): Promise<ActionState> {
  await requireSession();
  try {
    const r = await logRun("amazon", () => syncAmazon({ waitMs: 60_000 }));
    refresh();
    if (!isSpApiConfigured() && !isAdsConfigured()) return { error: "Connect Seller Central or Amazon Ads in Settings first. Until then SellerDoos shows sample data." };
    if (!r.marketplaces.length) return { error: r.errors[0] ?? "Amazon didn't list any marketplaces for this seller account." };
    const where = r.marketplaces.map((m) => `${marketplaces[m].flag} ${m}`).join(", ");
    const summary = `Synced ${where}: stock, fees and prices updated; ${r.queued} new report(s) queued, ${r.stored} rows stored.${
      r.pending ? ` Amazon is still building ${r.pending} report(s); they're collected automatically every few minutes (see Settings → report queue).` : ""
    }`;
    return r.errors.length ? { error: `${r.errors[0]} (${summary})` } : { message: summary };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function updateSettings(_: ActionState, form: FormData): Promise<ActionState> {
  await requireSession();
  const scheduleHour = Number(form.get("scheduleHour"));
  const serpPages = Number(form.get("serpPages"));
  const lowStockDays = Number(form.get("lowStockDays"));
  if (!(scheduleHour >= 0 && scheduleHour <= 23)) return { error: "Hour must be 0–23." };
  if (!(serpPages >= 1 && serpPages <= 7)) return { error: "Pages must be 1–7." };
  if (!(lowStockDays >= 1 && lowStockDays <= 180)) return { error: "Low-stock warning must be 1–180 days." };
  saveSettings({ scheduleHour, serpPages, lowStockDays });
  const seeds = String(form.get("researchSeeds") ?? "").slice(0, 2000);
  db.prepare("INSERT INTO settings (key, value) VALUES ('researchSeeds', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(seeds);
  refresh();
  return { message: "Saved." };
}

export async function clearDemoData() {
  await requireSession();
  clearDemo();
  refresh();
}

/** Cost of goods per unit (what you pay per item, landed), used for profit. Empty clears it. */
export async function updateUnitCost(productId: number, _: ActionState, form: FormData): Promise<ActionState> {
  await requireSession();
  const raw = String(form.get("unitCost") ?? "").trim();
  const value = raw === "" ? null : Number(raw);
  if (value !== null && !(value >= 0 && value < 100_000)) return { error: "Enter a cost like 6.40." };
  db.prepare("UPDATE products SET unit_cost = ? WHERE id = ?").run(value, productId);
  refresh();
  return { message: value === null ? "Cleared." : "Saved." };
}

export async function addCompetitor(productId: number, _: ActionState, form: FormData): Promise<ActionState> {
  await requireSession();
  const asins = [...new Set(String(form.get("asins") ?? "").toUpperCase().split(/[\s,]+/).filter(Boolean))];
  if (!asins.length || !asins.every(isAsin)) return { error: "Enter ASINs like B07XYZ1234, separated by commas or spaces." };
  const insert = db.prepare("INSERT OR IGNORE INTO competitors (product_id, asin) VALUES (?, ?)");
  let added = 0;
  db.transaction(() => asins.forEach((a) => (added += insert.run(productId, a).changes)))();
  refreshDemo();
  refresh();
  return { message: added ? `Watching ${added} more competitor${added === 1 ? "" : "s"}. Data appears after the next Amazon sync.` : "Already watching those." };
}

/** Watch a competitor found elsewhere (e.g. a top clicked ASIN in Research). */
export async function watchCompetitor(productId: number, asin: string) {
  await requireSession();
  if (isAsin(asin)) db.prepare("INSERT OR IGNORE INTO competitors (product_id, asin) VALUES (?, ?)").run(productId, asin);
  refreshDemo();
  refresh();
}

export async function removeCompetitor(competitorId: number) {
  await requireSession();
  db.prepare("DELETE FROM competitors WHERE id = ?").run(competitorId);
  refresh();
}

// ---- Credentials (Settings) ----

const EDITABLE: Record<CredentialGroup, readonly CredentialName[]> = {
  // The refresh token can be pasted for self-authorized apps (Seller Central's "Authorize app" button).
  seller: ["SPAPI_APP_ID", "SPAPI_CLIENT_ID", "SPAPI_CLIENT_SECRET", "SPAPI_REFRESH_TOKEN"],
  ads: ["ADS_CLIENT_ID", "ADS_CLIENT_SECRET"],
  dataforseo: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],
  rainforest: ["RAINFOREST_API_KEY"],
};

/** Saves app keys for one service. Blank fields keep what's already saved, so secrets needn't be re-entered. */
export async function saveCredentials(group: CredentialGroup, _: ActionState, form: FormData): Promise<ActionState> {
  await requireSession();
  let saved = 0;
  for (const name of EDITABLE[group]) {
    const value = String(form.get(name) ?? "").trim();
    if (value) {
      setCredential(name, value);
      saved++;
    }
  }
  if (group === "seller") setCredential("SPAPI_DRAFT", form.get("SPAPI_DRAFT") === "on" ? "true" : "false");
  pruneDemo();
  refresh();
  return { message: saved ? "Saved." : "Nothing changed (blank fields keep the saved value)." };
}

/** Forgets the connection (and, for key-only services, the keys). App keys for Amazon are kept for reconnecting. */
export async function disconnect(group: CredentialGroup) {
  await requireSession();
  recordSecurityEvent("disconnected", `${group} disconnected in Settings`);
  if (group === "seller") clearCredentials(["SPAPI_REFRESH_TOKEN", "SPAPI_SELLER_ID"]);
  else if (group === "ads") {
    clearCredentials(["ADS_REFRESH_TOKEN"]);
    db.prepare("DELETE FROM settings WHERE key LIKE 'adsProfile:%'").run();
  } else clearCredentials(CREDENTIALS[group]);
  refresh();
}

export async function acknowledgeSecurity() {
  await requireSession();
  acknowledgeSecurityEvents();
  refresh();
}

/** Asks Amazon which store and marketplaces the saved Seller Central connection belongs to. */
export async function testSellerConnection(): Promise<ActionState> {
  await requireSession();
  if (!isSpApiConfigured()) return { error: "Save your app keys and a refresh token (or click Connect) first." };
  try {
    const found = await sellerMarketplaces({ refresh: true });
    refresh();
    if (!found.length) return { error: "Connected, but Amazon listed no marketplaces where this account is selling." };
    const store = found.find((f) => f.storeName)?.storeName;
    return { message: `Working. ${store ? `Store “${store}”, ` : ""}selling in ${found.map((f) => `${marketplaces[f.code].flag} ${marketplaces[f.code].name}`).join(", ")}.` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

// ---- Shipments (cost of goods) ----

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const money = (v: unknown) => {
  const raw = String(v ?? "").trim().replace(/[$,]/g, "");
  return raw === "" ? 0 : Number(raw);
};

type ShipmentLineInput = { asin: string; qty: number | string; unitPrice: number | string; miscCharges: number | string; totalPaid: number | string; notes?: string };

/** Creates a shipment, or replaces one (form field `id`) with its lines. */
export async function saveShipment(_: ActionState, form: FormData): Promise<ActionState> {
  await requireSession();
  const id = Number(form.get("id")) || null;
  const ref = String(form.get("ref") ?? "").trim();
  const supplier = String(form.get("supplier") ?? "").trim();
  const orderDate = String(form.get("orderDate") ?? "");
  const status = String(form.get("status") ?? "ordered");
  const arrivedDate = String(form.get("arrivedDate") ?? "");
  const placementFee = money(form.get("placementFee"));
  const otherCosts = money(form.get("otherCosts"));
  const notes = String(form.get("notes") ?? "").trim();

  if (!ref) return { error: "Give the shipment a reference, like KB_004." };
  if (!isDate(orderDate)) return { error: "Pick the order date." };
  if (!["ordered", "in_transit", "arrived"].includes(status)) return { error: "Pick a status." };
  if (status === "arrived" && !isDate(arrivedDate)) return { error: "Pick the date it arrived at Amazon." };
  if (!(placementFee >= 0) || !(otherCosts >= 0)) return { error: "Fees must be amounts like 82.00." };
  const clash = db.prepare("SELECT id FROM shipments WHERE ref = ? AND id IS NOT ?").get(ref, id);
  if (clash) return { error: `There's already a shipment ${ref}.` };

  let raw: ShipmentLineInput[];
  try {
    raw = JSON.parse(String(form.get("lines") ?? "[]"));
  } catch {
    return { error: "Couldn't read the products on this shipment." };
  }
  const lines = raw
    .filter((l) => l.asin || String(l.qty).trim())
    .map((l) => {
      const qty = Number(l.qty);
      const unitPrice = money(l.unitPrice);
      const miscCharges = money(l.miscCharges);
      const paid = String(l.totalPaid ?? "").trim() === "" ? Math.round((qty * unitPrice + miscCharges) * 100) / 100 : money(l.totalPaid);
      return { asin: l.asin, qty, unitPrice, miscCharges, totalPaid: paid, notes: String(l.notes ?? "").trim() };
    });
  if (!lines.length) return { error: "Add at least one product." };
  for (const [i, l] of lines.entries()) {
    if (!isAsin(l.asin)) return { error: `Line ${i + 1}: pick a product.` };
    if (!(Number.isInteger(l.qty) && l.qty > 0)) return { error: `Line ${i + 1}: quantity must be a whole number above 0.` };
    if (![l.unitPrice, l.miscCharges, l.totalPaid].every((n) => n >= 0 && n < 10_000_000)) return { error: `Line ${i + 1}: amounts must be like 8.25.` };
    if (!l.totalPaid) return { error: `Line ${i + 1}: enter what you paid (or a unit price).` };
  }

  db.transaction(() => {
    const values = [ref, supplier, orderDate, status, status === "arrived" ? arrivedDate : null, placementFee, otherCosts, notes];
    let shipmentId = id;
    if (id) {
      db.prepare("UPDATE shipments SET ref = ?, supplier = ?, order_date = ?, status = ?, arrived_date = ?, placement_fee = ?, other_costs = ?, notes = ? WHERE id = ?").run(...values, id);
      db.prepare("DELETE FROM shipment_items WHERE shipment_id = ?").run(id);
    } else {
      shipmentId = Number(
        db.prepare("INSERT INTO shipments (ref, supplier, order_date, status, arrived_date, placement_fee, other_costs, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(...values).lastInsertRowid,
      );
    }
    const insert = db.prepare("INSERT INTO shipment_items (shipment_id, asin, qty, unit_price, misc_charges, total_paid, notes) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const l of lines) insert.run(shipmentId, l.asin, l.qty, l.unitPrice, l.miscCharges, l.totalPaid, l.notes);
  })();
  refresh();
  return { message: id ? `Saved ${ref}.` : `Added ${ref}.` };
}

export async function setShipmentStatus(id: number, status: "ordered" | "in_transit" | "arrived", arrivedDate?: string): Promise<ActionState> {
  await requireSession();
  if (status === "arrived" && !(arrivedDate && isDate(arrivedDate))) return { error: "Pick the date it arrived." };
  db.prepare("UPDATE shipments SET status = ?, arrived_date = ? WHERE id = ?").run(status, status === "arrived" ? arrivedDate : null, id);
  refresh();
  return { message: "Updated." };
}

export async function deleteShipment(id: number): Promise<ActionState> {
  await requireSession();
  db.prepare("DELETE FROM shipments WHERE id = ?").run(id);
  refresh();
  return { message: "Deleted." };
}

// ---- Misc charges ----

/** Adds or edits a charge you entered (form field `id`). A new category can be created on the way. */
export async function saveExpense(_: ActionState, form: FormData): Promise<ActionState> {
  await requireSession();
  const id = Number(form.get("id")) || null;
  const date = String(form.get("date") ?? "");
  let category = String(form.get("category") ?? "");
  const newCategory = String(form.get("newCategory") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const amount = money(form.get("amount"));
  const notes = String(form.get("notes") ?? "").trim();

  if (!isDate(date)) return { error: "Pick a date." };
  if (!description) return { error: "Say what it was for, like \"Helium10\"." };
  if (!(amount > 0 && amount < 10_000_000)) return { error: "Enter the amount, like 99.00." };
  if (category === "__new") {
    if (!newCategory) return { error: "Name the new category." };
    const existing = db.prepare("SELECT key FROM expense_categories WHERE name = ? COLLATE NOCASE").get(newCategory) as { key: string } | undefined;
    category = existing?.key ?? `c_${newCategory.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30)}_${Date.now().toString(36)}`;
    if (!existing) {
      const position = (db.prepare("SELECT COALESCE(MAX(position), 0) + 10 p FROM expense_categories").get() as { p: number }).p;
      db.prepare("INSERT INTO expense_categories (key, name, position) VALUES (?, ?, ?)").run(category, newCategory, position);
    }
  }
  const allowed = category === "advertising" || db.prepare("SELECT 1 FROM expense_categories WHERE key = ?").get(category);
  if (!allowed) return { error: "Pick a category." };

  if (id) {
    const row = db.prepare("SELECT source FROM expenses WHERE id = ?").get(id) as { source: string } | undefined;
    if (!row) return { error: "That charge no longer exists." };
    if (row.source === "spapi") return { error: "Charges from Amazon can't be edited." };
    db.prepare("UPDATE expenses SET date = ?, category = ?, description = ?, amount = ?, notes = ? WHERE id = ?").run(date, category, description, amount, notes, id);
  } else {
    db.prepare("INSERT INTO expenses (date, category, description, amount, notes, source) VALUES (?, ?, ?, ?, ?, 'manual')").run(date, category, description, amount, notes);
  }
  refresh();
  return { message: id ? "Saved." : "Added." };
}

export async function deleteExpense(id: number): Promise<ActionState> {
  await requireSession();
  const row = db.prepare("SELECT source FROM expenses WHERE id = ?").get(id) as { source: string } | undefined;
  if (row?.source === "spapi") return { error: "Charges from Amazon can't be deleted." };
  db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
  refresh();
  return { message: "Deleted." };
}

/** Re-reads Amazon account charges now. */
export async function syncExpensesNow(): Promise<ActionState> {
  await requireSession();
  if (!isSpApiConfigured()) return { error: "Connect Seller Central first (Settings)." };
  const r = await syncExpenses(await accountMarketplaces());
  refresh();
  return r.errors.length ? { error: r.errors[0] } : { message: `Up to date: ${r.stored} Amazon charge${r.stored === 1 ? "" : "s"} checked.` };
}
