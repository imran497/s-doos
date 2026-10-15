import { getCredential } from "../credentials";
import { marketplaces, type MarketplaceCode } from "../marketplaces";
import { tokenUrl } from "./http";

// "Connect with Amazon": send the user to Amazon's own login and approval page, then swap the code
// Amazon returns for a long-lived refresh token. Amazon never shares passwords with apps.
//
// - Seller Central (SP-API): website authorization workflow. The app must be registered as a public app
//   (Draft is fine; the owner authorizes it with version=beta) with this redirect URI.
// - Amazon Ads: Login with Amazon authorization code grant, scope advertising::campaign_management.

export type ConnectKind = "seller" | "ads";

export const isConnectKind = (kind: string): kind is ConnectKind => kind === "seller" || kind === "ads";

/** Where Amazon sends the user back to. Must be registered with Amazon exactly. */
export const redirectUri = (origin: string, kind: ConnectKind) => `${origin}/api/amazon/callback/${kind}`;

const LWA_AUTHORIZE = {
  na: "https://www.amazon.com/ap/oa",
  eu: "https://eu.account.amazon.com/ap/oa",
  fe: "https://apac.account.amazon.com/ap/oa",
} as const;

/** App keys missing for a connect flow, if any (shown as an error instead of sending the user to Amazon). */
export function missingAppKeys(kind: ConnectKind) {
  const needed = kind === "seller" ? (["SPAPI_APP_ID", "SPAPI_CLIENT_ID", "SPAPI_CLIENT_SECRET"] as const) : (["ADS_CLIENT_ID", "ADS_CLIENT_SECRET"] as const);
  return needed.filter((name) => !getCredential(name));
}

/** Amazon's consent page for this kind and marketplace. AMAZON_AUTH_BASE points it at a local mock in tests. */
export function authorizationUrl(kind: ConnectKind, m: MarketplaceCode, redirect: string, state: string) {
  const mock = process.env.AMAZON_AUTH_BASE;
  if (kind === "seller") {
    const params = new URLSearchParams({ application_id: getCredential("SPAPI_APP_ID") ?? "", state, redirect_uri: redirect });
    // Apps still in Draft can only be authorized by their owner, with version=beta.
    if (getCredential("SPAPI_DRAFT") !== "false") params.set("version", "beta");
    return `${mock ?? marketplaces[m].sellerCentral}/apps/authorize/consent?${params}`;
  }
  const params = new URLSearchParams({
    client_id: getCredential("ADS_CLIENT_ID") ?? "",
    scope: "advertising::campaign_management",
    response_type: "code",
    state,
    redirect_uri: redirect,
  });
  return `${mock ? `${mock}/ap/oa` : LWA_AUTHORIZE[marketplaces[m].region]}?${params}`;
}

/** Swaps an authorization code (valid for 5 minutes) for a refresh token. */
export async function exchangeCode(kind: ConnectKind, m: MarketplaceCode, code: string, redirect: string) {
  const [clientId, clientSecret] =
    kind === "seller" ? [getCredential("SPAPI_CLIENT_ID"), getCredential("SPAPI_CLIENT_SECRET")] : [getCredential("ADS_CLIENT_ID"), getCredential("ADS_CLIENT_SECRET")];
  // SP-API always exchanges at the North America endpoint; Amazon Ads at the regional one.
  const url = kind === "seller" ? tokenUrl() : tokenUrl(marketplaces[m].region);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: clientId ?? "", client_secret: clientSecret ?? "" }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { refresh_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.refresh_token) throw new Error(body.error_description ?? body.error ?? `Amazon returned ${res.status}`);
  return body.refresh_token;
}
