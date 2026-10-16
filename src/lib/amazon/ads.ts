import { marketplaces, type MarketplaceCode } from "../marketplaces";
import { getCredential } from "../credentials";
import { recordSecurityEvent } from "../security";
import { ApiError, downloadText, fetchWithRetry, lwaAccessToken, tokenUrl } from "./http";

// Amazon Ads API client (Sponsored Products reporting v3). Request shapes follow Amazon's official
// Postman collection (github.com/amzn/ads-advanced-tools-docs). Needs an approved Ads API app.

const ENDPOINTS = {
  na: "https://advertising-api.amazon.com",
  eu: "https://advertising-api-eu.amazon.com",
  fe: "https://advertising-api-fe.amazon.com",
} as const;

/** Connected = Login with Amazon app keys saved and the account has authorized it (refresh token). */
export const isAdsConfigured = () =>
  Boolean(getCredential("ADS_CLIENT_ID") && getCredential("ADS_CLIENT_SECRET") && getCredential("ADS_REFRESH_TOKEN"));

const clientId = () => getCredential("ADS_CLIENT_ID") ?? "";
// Ads tokens are refreshed at the regional Login with Amazon endpoint.
const accessToken = (m: MarketplaceCode) =>
  lwaAccessToken(clientId(), getCredential("ADS_CLIENT_SECRET") ?? "", getCredential("ADS_REFRESH_TOKEN") ?? "", "Amazon Ads", tokenUrl(marketplaces[m].region));
/** ADS_ENDPOINT overrides the regional host (used by the local mock in scripts/). */
const baseUrl = (marketplace: MarketplaceCode) => process.env.ADS_ENDPOINT ?? ENDPOINTS[marketplaces[marketplace].region];

async function call<T>(marketplace: MarketplaceCode, path: string, init: RequestInit & { profileId?: string } = {}): Promise<T> {
  const { profileId, ...rest } = init;
  const res = await fetchWithRetry(`${baseUrl(marketplace)}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${await accessToken(marketplace)}`,
      "Amazon-Advertising-API-ClientId": clientId(),
      ...(profileId ? { "Amazon-Advertising-API-Scope": profileId } : {}),
      ...rest.headers,
    },
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const b = body as { message?: string; detail?: string; code?: string };
    if (res.status === 401 || res.status === 403) recordSecurityEvent("access_denied", `Amazon Ads ${res.status} on ${path}: ${b.detail ?? b.message ?? ""}`);
    throw new ApiError(`Amazon Ads ${res.status} on ${path}: ${b.detail ?? b.message ?? res.statusText}`, res.status, body);
  }
  return body as T;
}

export type AdsProfile = {
  profileId: number;
  countryCode: string;
  currencyCode: string;
  accountInfo?: { type?: string; name?: string; marketplaceStringId?: string };
};

/** Advertising profiles (one per marketplace the account advertises in). */
export async function listProfiles(marketplace: MarketplaceCode) {
  return call<AdsProfile[]>(marketplace, "/v2/profiles");
}

/** The seller profile for a marketplace, matched on Amazon's marketplace id. */
export async function findProfile(marketplace: MarketplaceCode) {
  const profiles = await listProfiles(marketplace);
  const id = marketplaces[marketplace].id;
  return (
    profiles.find((p) => p.accountInfo?.marketplaceStringId === id && p.accountInfo?.type === "seller") ??
    profiles.find((p) => p.accountInfo?.marketplaceStringId === id) ??
    null
  );
}

export type AdsReportKind = "searchTerms" | "products";

const CONFIG: Record<AdsReportKind, { reportTypeId: string; groupBy: string[]; columns: string[]; optional?: string[] }> = {
  searchTerms: {
    reportTypeId: "spSearchTerm",
    groupBy: ["searchTerm"],
    columns: ["date", "searchTerm", "keyword", "matchType", "campaignName", "adGroupName", "impressions", "clicks", "cost", "purchases7d", "sales7d", "unitsSoldClicks7d"],
    // Not confirmed for this report type; dropped automatically if Amazon rejects it.
    optional: ["topOfSearchImpressionShare"],
  },
  products: {
    reportTypeId: "spAdvertisedProduct",
    groupBy: ["advertiser"],
    columns: ["date", "campaignName", "adGroupName", "advertisedAsin", "advertisedSku", "impressions", "clicks", "cost", "purchases7d", "sales7d", "unitsSoldClicks7d"],
  },
};

/** Requests a daily Sponsored Products report (max 31 days). Returns Amazon's report id. */
export async function createAdsReport(marketplace: MarketplaceCode, profileId: string, kind: AdsReportKind, start: string, end: string) {
  const cfg = CONFIG[kind];
  const request = (columns: string[]) =>
    call<{ reportId: string }>(marketplace, "/reporting/reports", {
      method: "POST",
      profileId,
      headers: { "Content-Type": "application/vnd.createasyncreportrequest.v3+json" },
      body: JSON.stringify({
        name: `SellerDoos ${kind} ${start} to ${end}`,
        startDate: start,
        endDate: end,
        configuration: { adProduct: "SPONSORED_PRODUCTS", groupBy: cfg.groupBy, columns, reportTypeId: cfg.reportTypeId, timeUnit: "DAILY", format: "GZIP_JSON" },
      }),
    });

  try {
    return (await request([...cfg.columns, ...(cfg.optional ?? [])])).reportId;
  } catch (error) {
    // 425: an identical report was already requested; Amazon names it in the message.
    if (error instanceof ApiError && error.status === 425) {
      const existing = error.message.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
      if (existing) return existing;
    }
    if (error instanceof ApiError && error.status === 400 && cfg.optional?.length) return (await request(cfg.columns)).reportId;
    throw error;
  }
}

/** PENDING / PROCESSING / COMPLETED / FAILED. */
export async function getAdsReport(marketplace: MarketplaceCode, profileId: string, reportId: string) {
  const r = await call<{ status: string; url?: string; failureReason?: string }>(marketplace, `/reporting/reports/${reportId}`, {
    profileId,
    headers: { "Content-Type": "application/vnd.createasyncreportrequest.v3+json" },
  });
  return r;
}

export type AdsSearchTermRow = {
  date: string;
  searchTerm: string;
  keyword: string | null;
  matchType: string | null;
  campaign: string | null;
  adGroup: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  purchases: number;
  sales: number;
  units: number;
  topShare: number | null;
};

export type AdsProductRow = {
  date: string;
  asin: string;
  sku: string | null;
  campaign: string | null;
  adGroup: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  purchases: number;
  sales: number;
  units: number;
};

/** Downloads a COMPLETED report (a gzipped JSON array of flat rows). */
export async function downloadAdsReport(url: string, kind: "searchTerms"): Promise<AdsSearchTermRow[]>;
export async function downloadAdsReport(url: string, kind: "products"): Promise<AdsProductRow[]>;
export async function downloadAdsReport(url: string, kind: AdsReportKind) {
  const rows = JSON.parse(await downloadText(url, true)) as Record<string, unknown>[];
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  if (kind === "searchTerms") {
    return rows
      .filter((r) => s(r.searchTerm))
      .map((r) => ({
        date: String(r.date),
        searchTerm: String(r.searchTerm).toLowerCase(),
        keyword: s(r.keyword),
        matchType: s(r.matchType),
        campaign: s(r.campaignName),
        adGroup: s(r.adGroupName),
        impressions: n(r.impressions),
        clicks: n(r.clicks),
        cost: n(r.cost),
        purchases: n(r.purchases7d),
        sales: n(r.sales7d),
        units: n(r.unitsSoldClicks7d),
        topShare: r.topOfSearchImpressionShare == null ? null : n(r.topOfSearchImpressionShare),
      }));
  }
  return rows
    .filter((r) => s(r.advertisedAsin))
    .map((r) => ({
      date: String(r.date),
      asin: String(r.advertisedAsin),
      sku: s(r.advertisedSku),
      campaign: s(r.campaignName),
      adGroup: s(r.adGroupName),
      impressions: n(r.impressions),
      clicks: n(r.clicks),
      cost: n(r.cost),
      purchases: n(r.purchases7d),
      sales: n(r.sales7d),
      units: n(r.unitsSoldClicks7d),
    }));
}
