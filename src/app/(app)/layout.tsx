import { Suspense } from "react";
import { SidebarLoader } from "@/components/SidebarLoader";
import { requireSession } from "@/lib/session";

/** The app itself: menu on the left, page on the right. Public pages (/login, /privacy) live outside this group. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <SignedIn>
        <div className="min-h-full lg:flex">
          <Suspense fallback={<div className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar lg:block" />}>
            <SidebarLoader />
          </Suspense>
          <main className="min-w-0 flex-1">
            <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-8 lg:py-8">{children}</div>
          </main>
        </div>
      </SignedIn>
    </Suspense>
  );
}

/** Renders nothing of the app until the session is confirmed on the server (Proxy checks first). */
async function SignedIn({ children }: { children: React.ReactNode }) {
  await requireSession();
  return children;
}
