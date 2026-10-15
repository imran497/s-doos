import { connection } from "next/server";
import { Sidebar } from "@/components/Sidebar";
import { isSpApiConfigured } from "@/lib/amazon/spapi";
import { authMode } from "@/lib/auth";
import { lowStockCount } from "@/lib/commerce";
import { db } from "@/lib/db";
import { marketplaces, type MarketplaceCode } from "@/lib/marketplaces";
import { unacknowledgedCount } from "@/lib/security";

/** Loads the menu's product list and warning counts on each request. */
export async function SidebarLoader() {
  await connection();
  const products = (
    // Inactive listings stay on the Products page but are left out of the menu.
    db
      .prepare(
        `SELECT id, asin, marketplace, title FROM products p
         WHERE NOT EXISTS (SELECT 1 FROM listings l WHERE l.marketplace = p.marketplace AND l.asin = p.asin)
            OR EXISTS (SELECT 1 FROM listings l WHERE l.marketplace = p.marketplace AND l.asin = p.asin AND l.status = 'Active')
         ORDER BY id`,
      )
      .all() as { id: number; asin: string; marketplace: MarketplaceCode; title: string | null }[]
  ).map((p) => ({ id: p.id, asin: p.asin, title: p.title, flag: marketplaces[p.marketplace].flag }));
  return <Sidebar products={products} canAdd={!isSpApiConfigured()} canSignOut={authMode() === "on"} badges={{ security: unacknowledgedCount(), lowStock: lowStockCount() }} />;
}
