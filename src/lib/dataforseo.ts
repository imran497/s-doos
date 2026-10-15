import { getCredential } from "./credentials";
import { marketplaces, type MarketplaceCode } from "./marketplaces";

// DataForSEO client (https://docs.dataforseo.com/v3/). Two APIs are used:
// - Merchant API › Amazon › Products (standard queue): ranked search results for a keyword.
// - DataForSEO Labs › Amazon › Bulk Search Volume (live): monthly search volume estimates.

// DATAFORSEO_API_URL can point at DataForSEO's free sandbox (https://sandbox.dataforseo.com/v3) for testing.
const API = process.env.DATAFORSEO_API_URL ?? "https://api.dataforseo.com/v3";

export const isDataForSeoConfigured = () => Boolean(getCredential("DATAFORSEO_LOGIN") && getCredential("DATAFORSEO_PASSWORD"));

type Task<T> = { id: string; status_code: number; status_message: string; result: T[] | null };
type Envelope<T> = { status_code: number; status_message: string; tasks?: Task<T>[] };

async function call<T>(path: string, body?: unknown): Promise<Task<T>[]> {
  const auth = Buffer.from(`${getCredential("DATAFORSEO_LOGIN")}:${getCredential("DATAFORSEO_PASSWORD")}`).toString("base64");
  const res = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok || json.status_code !== 20000) {
    throw new Error(`DataForSEO ${json.status_code ?? res.status}: ${json.status_message ?? res.statusText}`);
  }
  return json.tasks ?? [];
}

// Merchant API location (Google geo target codes) and language per marketplace.
// Canada has no Amazon language of its own in DataForSEO, so it uses en_US on amazon.ca.
const merchantLocale: Record<MarketplaceCode, { location: number; language: string }> = {
  US: { location: 2840, language: "en_US" },
  CA: { location: 2124, language: "en_US" },
  MX: { location: 2484, language: "es_MX" },
  UK: { location: 2826, language: "en_GB" },
  DE: { location: 2276, language: "de_DE" },
  FR: { location: 2250, language: "fr_FR" },
  IT: { location: 2380, language: "it_IT" },
  ES: { location: 2724, language: "es_ES" },
  IN: { location: 2356, language: "en_IN" },
  AE: { location: 2784, language: "ar_AE" },
  JP: { location: 2392, language: "ja_JP" },
  AU: { location: 2036, language: "en_AU" },
};

// ---- Amazon search results (asynchronous: post a task, collect it a few minutes later) ----

export type SearchTask = { keyword: string; marketplace: MarketplaceCode; depth: number; tag: string };

/** Queues searches (standard priority) and returns DataForSEO task ids in the same order. */
export async function postAmazonSearches(searches: SearchTask[]) {
  const ids: { tag: string; id: string | null; error?: string }[] = [];
  for (let i = 0; i < searches.length; i += 100) {
    const batch = searches.slice(i, i + 100);
    const tasks = await call<never>(
      "/merchant/amazon/products/task_post",
      batch.map((s) => ({
        keyword: s.keyword,
        location_code: merchantLocale[s.marketplace].location,
        language_code: merchantLocale[s.marketplace].language,
        se_domain: marketplaces[s.marketplace].domain,
        depth: s.depth,
        priority: 1,
        tag: s.tag,
      })),
    );
    batch.forEach((s, j) => {
      const t = tasks[j];
      ids.push(t?.status_code === 20100 ? { tag: s.tag, id: t.id } : { tag: s.tag, id: null, error: t?.status_message ?? "No task created" });
    });
  }
  return ids;
}

type ProductsResult = {
  items?: { type: string; rank_group?: number; rank_absolute?: number; data_asin?: string; title?: string; image_url?: string }[];
};

export type SearchOutcome =
  | { status: "pending" }
  | { status: "error"; message: string }
  | { status: "done"; items: { asin: string; sponsored: boolean; title?: string; imageUrl?: string }[] };

/** Fetches a queued search. Collecting results is free. */
export async function getAmazonSearch(taskId: string): Promise<SearchOutcome> {
  const [task] = await call<ProductsResult>(`/merchant/amazon/products/task_get/advanced/${taskId}`);
  if (!task || task.status_code === 40601 || task.status_code === 40602) return { status: "pending" };
  if (task.status_code === 40102) return { status: "done", items: [] }; // Amazon showed no results
  if (task.status_code !== 20000) return { status: "error", message: `${task.status_code} ${task.status_message}` };

  const items = (task.result?.[0]?.items ?? [])
    .filter((i) => (i.type === "amazon_serp" || i.type === "amazon_paid") && i.data_asin)
    .sort((a, b) => (a.rank_absolute ?? 0) - (b.rank_absolute ?? 0))
    .map((i) => ({ asin: i.data_asin!, sponsored: i.type === "amazon_paid", title: i.title, imageUrl: i.image_url }));
  return { status: "done", items };
}

// ---- Search volume (live) ----

// DataForSEO Labs only covers some Amazon marketplaces (not Japan).
const labsLocale: Partial<Record<MarketplaceCode, { location: number; language: string }>> = {
  US: { location: 2840, language: "en" },
  CA: { location: 2124, language: "en" },
  MX: { location: 2484, language: "es" },
  UK: { location: 2826, language: "en" },
  DE: { location: 2276, language: "de" },
  FR: { location: 2250, language: "fr" },
  IT: { location: 2380, language: "it" },
  ES: { location: 2724, language: "es" },
  IN: { location: 2356, language: "en" },
  AE: { location: 2784, language: "ar" },
  AU: { location: 2036, language: "en" },
};

export const supportsSearchVolume = (marketplace: MarketplaceCode) => marketplace in labsLocale;

/** Estimated monthly Amazon searches for up to 1,000 keywords per call. */
export async function getSearchVolumes(marketplace: MarketplaceCode, keywords: string[]) {
  const locale = labsLocale[marketplace];
  const volumes = new Map<string, number | null>();
  if (!locale) return volumes;
  for (let i = 0; i < keywords.length; i += 1000) {
    const [task] = await call<{ items?: { keyword: string; search_volume: number | null }[] }>(
      "/dataforseo_labs/amazon/bulk_search_volume/live",
      [{ keywords: keywords.slice(i, i + 1000), location_code: locale.location, language_code: locale.language }],
    );
    if (task && task.status_code !== 20000) throw new Error(`DataForSEO ${task.status_code}: ${task.status_message}`);
    for (const item of task?.result?.[0]?.items ?? []) volumes.set(item.keyword.toLowerCase(), item.search_volume ?? null);
  }
  return volumes;
}
