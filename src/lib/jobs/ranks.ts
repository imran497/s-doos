// Keyword rank checks (DataForSEO, Rainforest or demo), search volume estimates, and the daily
// catalog snapshot (title, image, BSR) for your own products.
import { getAmazonSearch, getSearchVolumes, isDataForSeoConfigured, postAmazonSearches, supportsSearchVolume } from "../dataforseo";
import { addDays, db, today } from "../db";
import type { MarketplaceCode } from "../marketplaces";
import { getSerpProvider, type SerpProvider } from "../serp";
import { demoRanks } from "../serp/demo";
import { getSettings } from "../settings";
import { getCatalogItem, isSpApiConfigured } from "../amazon/spapi";

type ProductRow = { id: number; asin: string; marketplace: MarketplaceCode; title: string | null; image_url: string | null };
type KeywordRow = { id: number; product_id: number; keyword: string };

/** Positions of the ASIN in an ordered results list: organic counts only organic results, sponsored only ads. */
function ranksIn(items: { asin: string; sponsored: boolean; title?: string; imageUrl?: string }[], asin: string) {
  let organicSeen = 0;
  let sponsoredSeen = 0;
  let organic: number | null = null;
  let sponsored: number | null = null;
  let listing: { title?: string; imageUrl?: string } | undefined;
  let ad: { title?: string; imageUrl?: string } | undefined;
  for (const item of items) {
    if (item.sponsored) sponsoredSeen++;
    else organicSeen++;
    if (item.asin !== asin) continue;
    if (item.sponsored) {
      sponsored ??= sponsoredSeen;
      ad ??= item;
    } else {
      organic ??= organicSeen;
      listing ??= item;
    }
  }
  // Prefer the organic listing for the product's title and image.
  return { organic, sponsored, found: listing ?? ad };
}

/** Fills in a missing product title and image from a search result. */
function rememberListing(product: Pick<ProductRow, "id">, found: { title?: string; imageUrl?: string } | undefined) {
  if (!found) return;
  // Only fills empty fields, so the first result found wins and SP-API's catalog data is never overwritten.
  db.prepare("UPDATE products SET title = COALESCE(title, ?), image_url = COALESCE(image_url, ?) WHERE id = ?").run(
    found.title ?? null,
    found.imageUrl ?? null,
    product.id,
  );
}

/** Scans search result pages until both the organic and sponsored position of the ASIN are known. */
async function findRanks(provider: SerpProvider, product: ProductRow, keyword: string, maxPages: number) {
  let organicSeen = 0;
  let sponsoredSeen = 0;
  let organic: number | null = null;
  let sponsored: number | null = null;
  let pagesChecked = 0;
  let found: { title?: string; imageUrl?: string } | undefined;

  for (let page = 1; page <= maxPages && (organic === null || sponsored === null); page++) {
    const result = await provider.search(keyword, product.marketplace, page);
    pagesChecked = page;
    for (const item of result.items) {
      if (item.sponsored) sponsoredSeen++;
      else organicSeen++;
      if (item.asin !== product.asin) continue;
      found ??= item;
      if (item.sponsored) sponsored ??= sponsoredSeen;
      else organic ??= organicSeen;
    }
    if (!result.hasMore) break;
  }
  return { organic, sponsored, pagesChecked, found };
}

const saveRank = db.prepare(`
  INSERT INTO rank_checks (keyword_id, checked_on, organic_rank, sponsored_rank, pages_checked, source)
  VALUES (@keywordId, @date, @organic, @sponsored, @pages, @source)
  ON CONFLICT(keyword_id, checked_on) DO UPDATE SET
    organic_rank = excluded.organic_rank, sponsored_rank = excluded.sponsored_rank,
    pages_checked = excluded.pages_checked, source = excluded.source, created_at = datetime('now', 'localtime')
`);

/**
 * Checks today's rank for every keyword of a product (or only `keywordIds`).
 * With DataForSEO the searches are queued; this waits up to `waitMs` for them and the
 * scheduler collects any that finish later.
 */
export async function checkProduct(productId: number, keywordIds?: number[], waitMs = 90_000) {
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(productId) as ProductRow | undefined;
  if (!product) throw new Error("Product not found");
  let keywords = db.prepare("SELECT * FROM keywords WHERE product_id = ?").all(productId) as KeywordRow[];
  if (keywordIds) keywords = keywords.filter((k) => keywordIds.includes(k.id));

  const provider = getSerpProvider();
  const { serpPages } = getSettings();
  const date = today();
  const errors: string[] = [];
  let checked = keywords.length;
  let pending = 0;

  if (provider.kind === "async") {
    const r = await queueSearches(product, keywords, date, serpPages);
    errors.push(...r.errors);
    const collected = await collectPending({ taskIds: r.taskIds, waitMs });
    errors.push(...collected.errors);
    checked = collected.done;
    pending = collected.pending;
  } else if (provider.isDemo) {
    // Demo mode fills the last 30 days so the charts have a history to show.
    const fill = db.transaction(() => {
      for (const k of keywords) {
        for (let i = 29; i >= 0; i--) {
          const day = addDays(date, -i);
          const r = demoRanks(product.asin, k.keyword, day);
          saveRank.run({ keywordId: k.id, date: day, organic: r.organic, sponsored: r.sponsored, pages: serpPages, source: "demo" });
        }
      }
    });
    fill();
  } else {
    // A few keywords at a time keeps us well inside API rate limits.
    const queue = [...keywords];
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        for (let k = queue.shift(); k; k = queue.shift()) {
          try {
            const r = await findRanks(provider, product, k.keyword, serpPages);
            saveRank.run({ keywordId: k.id, date, organic: r.organic, sponsored: r.sponsored, pages: r.pagesChecked, source: provider.id });
            rememberListing(product, r.found);
          } catch (error) {
            errors.push(`"${k.keyword}": ${(error as Error).message}`);
            checked--;
          }
        }
      }),
    );
  }

  if (isSpApiConfigured() && !keywordIds) {
    try {
      await snapshotCatalog(product);
    } catch (error) {
      errors.push(`BSR: ${(error as Error).message}`);
    }
  }
  return { checked, pending, errors };
}

// ---- DataForSEO: queue searches, then collect them ----

/** DataForSEO bills per 100 results, so scan whole hundreds: 2 pages ≈ 100 results. */
const depthFor = (pages: number) => Math.min(700, Math.ceil((pages * 48) / 100) * 100);

async function queueSearches(product: ProductRow, keywords: KeywordRow[], date: string, pages: number) {
  // Skip keywords that already have a search queued for today.
  const queued = new Set(
    (db.prepare("SELECT keyword_id FROM serp_tasks WHERE status = 'pending' AND checked_on = ?").all(date) as { keyword_id: number }[]).map(
      (r) => r.keyword_id,
    ),
  );
  const todo = keywords.filter((k) => !queued.has(k.id));
  const depth = depthFor(pages);
  const errors: string[] = [];
  const taskIds: string[] = [];
  if (!todo.length) return { taskIds, errors };

  const posted = await postAmazonSearches(todo.map((k) => ({ keyword: k.keyword, marketplace: product.marketplace, depth, tag: String(k.id) })));
  const insert = db.prepare("INSERT INTO serp_tasks (task_id, keyword_id, checked_on) VALUES (?, ?, ?)");
  db.transaction(() => {
    for (const p of posted) {
      if (p.id) {
        insert.run(p.id, Number(p.tag), date);
        taskIds.push(p.id);
      } else {
        errors.push(`"${todo.find((k) => String(k.id) === p.tag)?.keyword}": ${p.error}`);
      }
    }
  })();
  return { taskIds, errors };
}

/**
 * Collects finished DataForSEO searches and saves their ranks. Polls every 10 seconds for up to
 * `waitMs` while any of `taskIds` (or any pending task, if omitted) are still processing.
 */
export async function collectPending({ taskIds, waitMs = 0 }: { taskIds?: string[]; waitMs?: number } = {}) {
  if (!isDataForSeoConfigured()) return { done: 0, pending: 0, errors: [] as string[] };
  // DataForSEO keeps results for a limited time; give up on searches older than 3 days.
  db.prepare("UPDATE serp_tasks SET status = 'expired' WHERE status = 'pending' AND created_at < datetime('now', 'localtime', '-3 days')").run();

  const deadline = Date.now() + waitMs;
  const errors: string[] = [];
  let done = 0;
  for (;;) {
    let rows = db
      .prepare(
        `SELECT t.task_id, t.keyword_id, t.checked_on, k.keyword, p.id AS product_id, p.asin, p.marketplace
         FROM serp_tasks t JOIN keywords k ON k.id = t.keyword_id JOIN products p ON p.id = k.product_id
         WHERE t.status = 'pending'`,
      )
      .all() as { task_id: string; keyword_id: number; checked_on: string; keyword: string; product_id: number; asin: string; marketplace: MarketplaceCode }[];
    if (taskIds) rows = rows.filter((r) => taskIds.includes(r.task_id));

    for (const r of rows) {
      try {
        const outcome = await getAmazonSearch(r.task_id);
        if (outcome.status === "pending") continue;
        if (outcome.status === "error") {
          db.prepare("UPDATE serp_tasks SET status = 'error', message = ? WHERE task_id = ?").run(outcome.message, r.task_id);
          errors.push(`"${r.keyword}": ${outcome.message}`);
          continue;
        }
        const ranks = ranksIn(outcome.items, r.asin);
        saveRank.run({
          keywordId: r.keyword_id,
          date: r.checked_on,
          organic: ranks.organic,
          sponsored: ranks.sponsored,
          pages: Math.ceil(outcome.items.length / 48) || 1,
          source: "dataforseo",
        });
        rememberListing({ id: r.product_id }, ranks.found);
        db.prepare("UPDATE serp_tasks SET status = 'done' WHERE task_id = ?").run(r.task_id);
        done++;
      } catch (error) {
        errors.push(`"${r.keyword}": ${(error as Error).message}`);
      }
    }

    const stillPending = (
      db.prepare("SELECT task_id FROM serp_tasks WHERE status = 'pending'").all() as { task_id: string }[]
    ).filter((r) => !taskIds || taskIds.includes(r.task_id)).length;
    if (!stillPending || Date.now() + 10_000 > deadline) return { done, pending: stillPending, errors };
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

// ---- Search volume estimates (DataForSEO Labs) ----

/** Fetches estimated monthly searches for keywords that have none yet, or whose estimate is over 30 days old. */
export async function refreshSearchVolumes(productId?: number) {
  if (!isDataForSeoConfigured()) return { updated: 0, errors: [] as string[] };
  const products = (
    productId ? db.prepare("SELECT * FROM products WHERE id = ?").all(productId) : db.prepare("SELECT * FROM products").all()
  ) as ProductRow[];
  const errors: string[] = [];
  let updated = 0;
  const save = db.prepare("UPDATE keywords SET est_volume = ?, est_volume_at = ? WHERE id = ?");

  for (const p of products) {
    if (!supportsSearchVolume(p.marketplace)) continue;
    const stale = db
      .prepare("SELECT id, keyword FROM keywords WHERE product_id = ? AND (est_volume_at IS NULL OR est_volume_at < ?)")
      .all(p.id, addDays(today(), -30)) as { id: number; keyword: string }[];
    if (!stale.length) continue;
    try {
      const volumes = await getSearchVolumes(p.marketplace, stale.map((k) => k.keyword));
      db.transaction(() => {
        for (const k of stale) save.run(volumes.get(k.keyword.toLowerCase()) ?? null, today(), k.id);
      })();
      updated += stale.length;
    } catch (error) {
      errors.push(`Search volume (${p.asin}): ${(error as Error).message}`);
    }
  }
  return { updated, errors };
}

/** Saves today's BSR, and fills in the product title and image. */
export async function snapshotCatalog(product: Pick<ProductRow, "id" | "asin" | "marketplace">) {
  const item = await getCatalogItem(product.asin, product.marketplace);
  db.prepare("UPDATE products SET title = COALESCE(?, title), image_url = COALESCE(?, image_url) WHERE id = ?").run(
    item.title ?? null,
    item.imageUrl ?? null,
    product.id,
  );
  const save = db.prepare(`
    INSERT INTO bsr_snapshots (product_id, checked_on, category, rank) VALUES (?, ?, ?, ?)
    ON CONFLICT(product_id, checked_on, category) DO UPDATE SET rank = excluded.rank
  `);
  for (const r of item.bsr) save.run(product.id, today(), r.category, r.rank);
}
