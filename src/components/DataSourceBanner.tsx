import Link from "next/link";
import { connection } from "next/server";
import { FlaskConical } from "lucide-react";
import { getSerpProvider } from "@/lib/serp";

/** Warns that ranks are made up until a real search results API key is configured. */
export async function DataSourceBanner() {
  await connection();
  if (!getSerpProvider().isDemo) return null;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-gold/30 bg-[#fdf6ea] px-4 py-3 text-sm text-ink">
      <FlaskConical className="mt-0.5 size-4 shrink-0" />
      <p>
        <strong>Demo mode:</strong> keyword ranks are made-up sample data. Connect DataForSEO (or Rainforest) to track real Amazon rankings; see{" "}
        <Link href="/settings" className="underline">
          Settings
        </Link>
        .
      </p>
    </div>
  );
}
