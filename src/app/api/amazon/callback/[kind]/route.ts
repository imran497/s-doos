import { unauthorized } from "@/lib/session";
import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, isConnectKind, redirectUri } from "@/lib/amazon/oauth";
import { setCredential } from "@/lib/credentials";
import { pruneDemo } from "@/lib/jobs";
import { db } from "@/lib/db";
import { recordSecurityEvent } from "@/lib/security";
import { isMarketplace } from "@/lib/marketplaces";

// Amazon sends the user back here after they approve (or decline). The authorization code is valid
// for only 5 minutes, so it's exchanged for a refresh token straight away and saved locally.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/amazon/callback/[kind]">) {
  const denied = await unauthorized();
  if (denied) return denied;
  const { kind } = await ctx.params;
  const params = request.nextUrl.searchParams;
  const settings = new URL("/settings", request.nextUrl.origin);
  const fail = (message: string) => {
    settings.searchParams.set("error", message);
    const response = NextResponse.redirect(settings);
    if (isConnectKind(kind)) response.cookies.delete({ name: `sd_oauth_${kind}`, path: "/api/amazon" });
    return response;
  };

  if (!isConnectKind(kind)) return fail("Unknown connection type.");
  const [expected, marketplace] = (request.cookies.get(`sd_oauth_${kind}`)?.value ?? "").split("|");
  if (!expected || params.get("state") !== expected) {
    // Either a stale link or someone trying to attach their Amazon account to this app.
    recordSecurityEvent("forged_callback", `${kind} callback with ${expected ? "a mismatched" : "no"} state from ${request.headers.get("referer") ?? "unknown referrer"}`);
    return fail("This sign-in link expired or didn't start here. Click Connect again.");
  }
  if (!marketplace || !isMarketplace(marketplace)) return fail("Missing marketplace. Click Connect again.");

  const declined = params.get("error_description") ?? params.get("error");
  if (declined) return fail(`Amazon said: ${declined}`);
  const code = kind === "seller" ? params.get("spapi_oauth_code") : params.get("code");
  if (!code) return fail("Amazon didn't send an authorization code. Click Connect again.");

  try {
    const refreshToken = await exchangeCode(kind, marketplace, code, redirectUri(request.nextUrl.origin, kind));
    if (kind === "seller") {
      setCredential("SPAPI_REFRESH_TOKEN", refreshToken);
      setCredential("SPAPI_SELLER_ID", params.get("selling_partner_id") ?? "");
    } else {
      setCredential("ADS_REFRESH_TOKEN", refreshToken);
      // A different Amazon Ads account may have been connected: look the profiles up again.
      db.prepare("DELETE FROM settings WHERE key LIKE 'adsProfile:%'").run();
    }
  } catch (error) {
    return fail(`Couldn't finish connecting: ${(error as Error).message}`);
  }

  pruneDemo();
  settings.searchParams.set("connected", kind);
  const response = NextResponse.redirect(settings);
  response.cookies.delete({ name: `sd_oauth_${kind}`, path: "/api/amazon" });
  return response;
}
