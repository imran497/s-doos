import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { authMode } from "@/lib/auth";
import { isSignedIn } from "@/lib/session";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-[17px] font-semibold tracking-tight">
          <Logo size={26} /> SellerDoos
        </div>
        <div className="rounded-lg border bg-card px-6 py-7 shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
          <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Your password and the 6-digit code from your authenticator app.</p>
          <Suspense>
            <Form {...props} />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          <a href="/privacy" className="hover:text-foreground">
            Privacy notice
          </a>
        </p>
      </div>
    </div>
  );
}

async function Form({ searchParams }: PageProps<"/login">) {
  if (authMode() === "off" || (await isSignedIn())) redirect("/");
  const next = (await searchParams).next;
  return <SignInForm next={typeof next === "string" ? next : "/"} />;
}
