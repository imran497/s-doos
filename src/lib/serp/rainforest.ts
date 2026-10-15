import { marketplaces, type MarketplaceCode } from "../marketplaces";
import type { SerpItem, SerpProvider } from "./types";

// Rainforest API (https://www.rainforestapi.com/docs/product-data-api/parameters/search).
// Each call returns one Amazon search results page and costs one request credit.
type RainforestResult = {
  asin?: string;
  position?: number;
  sponsored?: boolean;
  title?: string;
  image?: string;
};

type RainforestResponse = {
  request_info?: { success?: boolean; message?: string };
  search_results?: RainforestResult[];
  pagination?: { current_page?: number; total_pages?: number };
};

export function rainforestProvider(apiKey: string): SerpProvider {
  return {
    id: "rainforest",
    label: "Rainforest API",
    kind: "sync",
    isDemo: false,
    async search(keyword: string, marketplace: MarketplaceCode, page: number) {
      const params = new URLSearchParams({
        api_key: apiKey,
        type: "search",
        amazon_domain: marketplaces[marketplace].domain,
        search_term: keyword,
        page: String(page),
      });
      const res = await fetch(`https://api.rainforestapi.com/request?${params}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as RainforestResponse;
      if (!res.ok || body.request_info?.success === false) {
        throw new Error(`Rainforest API ${res.status}: ${body.request_info?.message ?? res.statusText}`);
      }

      const items: SerpItem[] = (body.search_results ?? [])
        .filter((r): r is RainforestResult & { asin: string } => Boolean(r.asin))
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((r) => ({ asin: r.asin, sponsored: Boolean(r.sponsored), title: r.title, imageUrl: r.image }));

      const totalPages = body.pagination?.total_pages;
      return { items, hasMore: items.length > 0 && (totalPages === undefined || page < totalPages) };
    },
  };
}
