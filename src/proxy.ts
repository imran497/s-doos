import { NextResponse, type NextRequest } from "next/server";
import { authMode, isValidSessionToken, SESSION_COOKIE } from "./lib/auth";

// First line of defence: anyone without a valid session goes to /login. Pages, server actions and API
// routes check again on the server (src/lib/session.ts), since Proxy is only an optimistic check.

const PUBLIC = ["/login", "/privacy", "/api/health"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const mode = authMode();

  if (mode === "off") return NextResponse.next();
  if (mode === "misconfigured") {
    if (pathname === "/privacy") return NextResponse.next();
    return new NextResponse("SellerDoos login isn't configured on this server. Run `npm run auth:setup` and set the environment variables.", { status: 503 });
  }
  if (isPublic || isValidSessionToken(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  // API calls and form posts get a plain refusal; page visits go to the login page and come back after.
  if (pathname.startsWith("/api/") || request.method !== "GET") {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except build assets and public images.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|gif)$).*)"],
};
