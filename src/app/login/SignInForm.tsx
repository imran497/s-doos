"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn } from "./actions";

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, undefined);
  return (
    <form action={action} className="mt-5 space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block space-y-1.5">
        <span className="text-xs font-medium">Password</span>
        <Input name="password" type="password" autoComplete="current-password" required autoFocus className="h-9 text-[13px]" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium">Authenticator code</span>
        <Input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          placeholder="123 456"
          required
          className="h-9 text-[13px] tracking-widest"
        />
      </label>
      {state?.error && <p className="text-[13px] text-destructive">{state.error}</p>}
      <Button type="submit" className="h-9 w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
