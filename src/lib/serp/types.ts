import type { MarketplaceCode } from "../marketplaces";

/** One product tile on an Amazon search results page, in on-page order. */
export type SerpItem = {
  asin: string;
  sponsored: boolean;
  title?: string;
  imageUrl?: string;
};

export type SerpPage = {
  items: SerpItem[];
  /** False when Amazon has no further result pages for this search. */
  hasMore: boolean;
};

/**
 * A source of Amazon search results. "sync" providers return one results page per call;
 * "async" providers (DataForSEO) queue searches and are collected later by the tracker.
 */
export interface SerpProvider {
  readonly id: string;
  readonly label: string;
  readonly kind: "sync" | "async" | "demo";
  /** True for the built-in demo source, whose ranks are made up. */
  readonly isDemo: boolean;
  search(keyword: string, marketplace: MarketplaceCode, page: number): Promise<SerpPage>;
}
