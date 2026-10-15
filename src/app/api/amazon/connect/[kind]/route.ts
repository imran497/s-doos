import { unauthorized } from "@/lib/session";
import { NextResponse, type NextRequest } from "next/server";
import { authorizationUrl, isConnectKind, missingAppKeys, redirectUri } from "@/lib/amazon/oauth";
import { isMarketplace } from "@/lib/marketplaces";

// Starts "Connect with Amazon": remembers a one-time state token in a short-lived cookie (to reject
// forged callbacks), then sends the user to Amazon's login and consent page.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/amazon/connect/[kind]">) {
  const denied = await unauthorized();
  if (denied) return denied;
  const { kind } = await ctx.params;
  const settings = new URL("/settings", request.nextUrl.origin);
  if (!isConnectKind(kind)) return NextResponse.redirect(settings);

  const missing = missingAppKeys(kind);
  if (missing.length) {
    settings.searchParams.set("error", `Save your app keys first (missing ${missing.join(", ")}).`);
    return NextResponse.redirect(settings);
  }

  const requested = request.nextUrl.searchParams.get("marketplace") ?? "US";
  const marketplace = isMarketplace(requested) ? requested : "US";
  const state = crypto.randomUUID();
  const response = NextResponse.redirect(authorizationUrl(kind, marketplace, redirectUri(request.nextUrl.origin, kind), state));
  response.cookies.set(`sd_oauth_${kind}`, `${state}|${marketplace}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    maxAge: 600,
    path: "/api/amazon",
  });
  return response;
}
