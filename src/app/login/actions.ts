"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authMode, clearFailures, createSessionToken, isLockedOut, recordFailure, SESSION_COOKIE, sessionCookieOptions, verifyPassword, verifyTotp } from "@/lib/auth";
import { recordSecurityEvent } from "@/lib/security";

export type SignInState = { error?: string } | undefined;

/** Where to go after signing in: only paths inside SellerDoos. */
const safeNext = (next: string) => (next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/");

export async function signIn(_: SignInState, form: FormData): Promise<SignInState> {
  if (authMode() !== "on") redirect("/");
  const ip = ((await headers()).get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  if (isLockedOut(ip)) return { error: "Too many attempts. Try again in 15 minutes." };

  const password = String(form.get("password") ?? "");
  const code = String(form.get("code") ?? "");
  const ok = verifyPassword(password, process.env.SELLERDOOS_PASSWORD_HASH!) && verifyTotp(process.env.SELLERDOOS_TOTP_SECRET!, code);
  if (!ok) {
    recordFailure(ip);
    recordSecurityEvent("signin_failed", `Wrong password or authenticator code from ${ip}`);
    if (isLockedOut(ip)) recordSecurityEvent("signin_locked", `Sign-ins from ${ip} paused for 15 minutes after repeated failures`);
    return { error: "That password or code isn't right." };
  }
  clearFailures(ip);
  (await cookies()).set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions);
  redirect(safeNext(String(form.get("next") ?? "/")));
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
