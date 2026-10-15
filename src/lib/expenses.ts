import "server-only";
import { connection } from "next/server";
import { db } from "./db";
import { AMAZON_CATEGORIES, type CategoryInfo, type ExpenseGroup } from "./expenses-meta";
import { ymd, type Period } from "./periods";

// Read side of the Misc charges page.

export type Expense = {
  id: number;
  date: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  notes: string;
  source: "manual" | "spapi" | "sheet";
};

/** Amazon categories first, then advertising, then your own (in the order you made them). */
export function expenseCategories(): CategoryInfo[] {
  const own = (db.prepare("SELECT key, name FROM expense_categories ORDER BY position, name").all() as { key: string; name: string }[]).map(
    (c): CategoryInfo => ({ key: c.key, name: c.name, group: "own", treatment: "cost", auto: false }),
  );
  return [...AMAZON_CATEGORIES, ...own];
}

export async function getExpenses(period: Period) {
  await connection();
  const categories = expenseCategories();
  const byKey = new Map(categories.map((c) => [c.key, c]));
  const from = ymd(period.start);
  const to = ymd(new Date(period.end.getTime() - 1));
  const rows = db
    .prepare("SELECT id, date, category, description, amount, currency, notes, source FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC")
    .all(from, to) as Expense[];

  const info = (key: string): CategoryInfo => byKey.get(key) ?? { key, name: key, group: "own", treatment: "cost", auto: false };
  const counted = rows.filter((r) => info(r.category).treatment === "cost");
  const sum = (list: Expense[]) => list.reduce((s, r) => s + r.amount, 0);
  const groupTotal = (g: ExpenseGroup) => sum(counted.filter((r) => info(r.category).group === g));

  const perCategory = categories
    .map((c) => {
      const own = rows.filter((r) => r.category === c.key);
      return { ...c, total: sum(own), count: own.length };
    })
    // Amazon categories only when they have charges; yours always, so you can see where to add.
    .filter((c) => c.count > 0 || c.group !== "amazon");

  // Monthly totals of counted charges, per group, across the period.
  const months: string[] = [];
  for (let d = new Date(period.start.getFullYear(), period.start.getMonth(), 1); d < period.end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    months.push(ymd(d).slice(0, 7));
  }
  const monthly = months.map((month) => {
    const inMonth = counted.filter((r) => r.date.startsWith(month));
    const g = (group: ExpenseGroup) => sum(inMonth.filter((r) => info(r.category).group === group));
    return {
      month,
      label: new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", { month: "short", year: months.length > 12 || month.slice(0, 4) !== months.at(-1)!.slice(0, 4) ? "2-digit" : undefined }),
      amazon: g("amazon"),
      advertising: g("advertising"),
      own: g("own"),
    };
  });

  return {
    rows,
    categories,
    perCategory,
    monthly,
    totals: {
      counted: sum(counted),
      amazon: groupTotal("amazon"),
      advertising: groupTotal("advertising"),
      own: groupTotal("own"),
      inShipments: sum(rows.filter((r) => info(r.category).treatment === "in_shipment")),
      transfers: sum(rows.filter((r) => info(r.category).treatment === "transfer")),
    },
    lastSynced: (db.prepare("SELECT value FROM settings WHERE key = 'expenses:syncedThrough'").get() as { value: string } | undefined)?.value ?? null,
  };
}

export type ExpensesData = Awaited<ReturnType<typeof getExpenses>>;
