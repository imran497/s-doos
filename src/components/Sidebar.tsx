"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LogOut,
  PieChart,
  Receipt,
  Ship,
  BarChart3,
  ChevronRight,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  Menu,
  Package,
  Plus,
  SearchCheck,
  Settings,
  Sparkles,
  Swords,
  Telescope,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/app/login/actions";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export type SidebarProduct = { id: number; asin: string; title: string | null; flag: string };
export type SidebarBadges = { security: number; lowStock: number };

const PRODUCT_TABS = [
  { tab: "overview", label: "Overview", icon: Sparkles },
  { tab: "queries", label: "Search Query Performance", icon: SearchCheck },
  { tab: "keywords", label: "Keywords", icon: KeyRound },
  { tab: "sales", label: "Sales & profit", icon: Wallet },
  { tab: "ads", label: "Ads", icon: Megaphone },
  { tab: "competitors", label: "Competitors", icon: Swords },
] as const;

const MORE = [
  { href: "/research", label: "Research", icon: Telescope },
  { href: "/business", label: "Business", icon: BarChart3, badge: "lowStock" as const },
  { href: "/settings", label: "Settings", icon: Settings, badge: "security" as const },
];

/** Fixed left navigation on desktop; a slide-over sheet on small screens. */
export function Sidebar({ products, badges, canAdd, canSignOut = false }: { products: SidebarProduct[]; badges: SidebarBadges; canAdd: boolean; canSignOut?: boolean }) {
  const [open, setOpen] = useState(false);
  const nav = <Nav products={products} badges={badges} canAdd={canAdd} canSignOut={canSignOut} onNavigate={() => setOpen(false)} />;
  return (
    <>
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-white/95 px-4 backdrop-blur lg:hidden">
        <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <Logo size={24} /> SellerDoos
        </Link>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Open menu">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 bg-sidebar p-0">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            {nav}
          </SheetContent>
        </Sheet>
      </header>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">{nav}</aside>
    </>
  );
}

function Nav({ products, badges, canAdd, canSignOut, onNavigate }: { products: SidebarProduct[]; badges: SidebarBadges; canAdd: boolean; canSignOut: boolean; onNavigate: () => void }) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab") ?? "overview";
  const currentProduct = pathname.match(/^\/products\/(\d+)/)?.[1];
  // A product is expanded while it's being viewed, unless the user toggled it.
  const [toggled, setToggled] = useState<Record<number, boolean>>({});
  const isOpen = (id: number) => toggled[id] ?? currentProduct === String(id);

  return (
    <nav
      className="flex h-full flex-col overflow-y-auto px-3 py-4"
      aria-label="Main"
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest("a")) onNavigate();
      }}
    >
      <Link href="/" className="mb-6 hidden items-center gap-2 px-2 text-[15px] font-semibold tracking-tight lg:flex">
        <Logo size={24} /> SellerDoos
      </Link>

      <div className="space-y-0.5">
        <NavItem href="/" icon={LayoutDashboard} label="Dashboard" active={pathname === "/"} />
        <div className="ml-[18px] space-y-0.5 border-l border-sidebar-border pl-2.5 pt-0.5">
          <NavItem href="/summary" icon={PieChart} label="Summary" active={pathname.startsWith("/summary")} small />
          <NavItem href="/products" icon={Package} label="Products" active={pathname === "/products"} small />
          {products.map((p) => {
            const active = currentProduct === String(p.id);
            const expanded = isOpen(p.id);
            return (
              <div key={p.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setToggled((t) => ({ ...t, [p.id]: !expanded }))}
                  title={p.title ?? p.asin}
                  className={cn(
                    "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    active && "font-medium text-sidebar-foreground",
                  )}
                >
                  <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
                  <span className="min-w-0 flex-1 truncate">{p.title ?? p.asin}</span>
                  <span className="text-[11px]">{p.flag}</span>
                </button>
                {expanded && (
                  <div className="ml-[13px] space-y-0.5 border-l border-sidebar-border py-0.5 pl-2">
                    {PRODUCT_TABS.map((t) => (
                      <NavItem key={t.tab} href={`/products/${p.id}?tab=${t.tab}`} icon={t.icon} label={t.label} active={active && tab === t.tab} small />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {/* Once Seller Central is connected, products come from your listings automatically. */}
          {canAdd && <NavItem href="/products?add=1" icon={Plus} label="Add product" active={false} small muted />}
          <NavItem href="/shipments" icon={Ship} label="Shipments" active={pathname.startsWith("/shipments")} small />
          <NavItem href="/misc-charges" icon={Receipt} label="Misc charges" active={pathname.startsWith("/misc-charges")} small />
        </div>
      </div>

      <div className="mt-6 space-y-0.5">
        <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">More</p>
        {MORE.map((m) => (
          <NavItem key={m.href} href={m.href} icon={m.icon} label={m.label} active={pathname.startsWith(m.href)} count={m.badge ? badges[m.badge] : 0} />
        ))}
        {canSignOut && (
          <form action={signOut}>
            <button
              type="submit"
              className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            >
              <LogOut className="size-4 text-muted-foreground" /> Sign out
            </button>
          </form>
        )}
      </div>
    </nav>
  );
}

function NavItem({ href, icon: Icon, label, active, small, muted, count = 0 }: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  small?: boolean;
  muted?: boolean;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60",
        small ? "h-7 text-[13px]" : "h-8 text-sm font-medium",
        active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground hover:bg-sidebar-accent",
        muted && "text-muted-foreground",
      )}
    >
      <Icon className={cn("shrink-0", small ? "size-3.5" : "size-4", active ? "text-sidebar-accent-foreground" : "text-muted-foreground")} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && <span className="rounded-full bg-destructive px-1.5 text-[11px] font-semibold leading-[18px] text-white">{count}</span>}
    </Link>
  );
}
