import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authMode, isValidSessionToken, SESSION_COOKIE } from "./auth";

// Server-side checks. Proxy (src/proxy.ts) redirects early, but it's only an optimistic check, so every
// server action, the app layout and the API routes verify the session again here.

export async function isSignedIn() {
  // Per request: the session check compares against the current time.
  await connection();
  const mode = authMode();
  if (mode === "off") return true;
  if (mode === "misconfigured") return false;
  return isValidSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** For pages and server actions: sends anyone not signed in to the login page. */
export async function requireSession() {
  if (!(await isSignedIn())) redirect("/login");
}

/** For route handlers: a 401 response to return when not signed in, else null. */
export async function unauthorized() {
  return (await isSignedIn()) ? null : Response.json({ error: "Sign in required" }, { status: 401 });
}
