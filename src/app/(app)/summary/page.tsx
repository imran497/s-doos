import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { formatValue } from "@/components/dashboard/format";
import { PageHeader, SectionHeader } from "@/components/PageHeader";
import { ProductThumb } from "@/components/ProductThumb";
import { Skeleton } from "@/components/ui/skeleton";
import { getSummary } from "@/lib/summary";
import { APP_TIME_ZONE, todayInAppZone } from "@/lib/timezone";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Summary" };

export default function SummaryPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Summary" description="Your whole business since the first shipment: what you've put in, what Amazon has paid back, and where that leaves you. All figures in USD." />
      <Suspense fallback={<SummarySkeleton />}>
        <SummaryContent />
      </Suspense>
    </div>
  );
}

const money = (n: number | null) => (n == null ? "—" : formatValue("money", n, "USD"));
/** Accounting style: losses in brackets. */
const signed = (n: number) => (n < 0 ? `(${formatValue("money", -n, "USD")})` : formatValue("money", n, "USD"));
/** An ISO timestamp or "yyyy-mm-dd hh:mm:ss" (server time, Central) as "Oct 16, 1:55 PM CDT". */
const stamp = (v: string) =>
  new Date(v.includes("T") ? v : v.replace(" ", "T")).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: APP_TIME_ZONE, timeZoneName: "short" });
/** The Central Time calendar day of an ISO timestamp, as yyyy-mm-dd. */
const dayInAppZone = (iso: string) => todayInAppZone(new Date(iso));
const short = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null);

type Line = { label: string; value: string; note: string; tone?: "good" | "bad"; strong?: boolean; href?: string };

async function SummaryContent() {
  const s = await getSummary();
  const out = s.moneyOut;
  const r = s.result;
  const tone = (n: number): "good" | "bad" => (n < 0 ? "bad" : "good");

  const kpis = [
    { label: "Total invested", value: money(out.totalInvested), note: "Everything spent so far" },
    { label: "Amazon payout", value: money(s.moneyBack.payout), note: `${s.moneyBack.unitsSold.toLocaleString()} units sold or given away, incl. pending` },
    { label: "Operating profit", value: signed(r.operating), note: "Profit on units sold minus overhead", tone: tone(r.operating) },
    { label: "Net cash incl. in transit", value: signed(r.netCashWithTransit), note: "Cash back minus everything spent", tone: tone(r.netCashWithTransit) },
  ];

  const moneyOut: Line[] = [
    { label: "Inventory arrived at Amazon", value: money(out.inventoryArrived), note: "Shipments marked arrived: product cost plus placement fee.", href: "/shipments" },
    { label: "Inventory paid, not arrived", value: money(out.inventoryOnTheWay), note: "Paid for, still ordered or in transit.", href: "/shipments" },
    { label: "Amazon charges", value: money(out.amazonCharges), note: "Subscription, storage, coupon fees and other account charges, less reimbursements.", href: "/misc-charges" },
    { label: "Advertising", value: money(out.advertising), note: "Amazon ads billed to your card.", href: "/misc-charges" },
    { label: "Tool subscriptions", value: money(out.tools), note: "Helium10, Pixii, SellerAmp and other tools.", href: "/misc-charges" },
    { label: "Other costs", value: money(out.otherCosts), note: "Samples, trademark, UPC codes, inspections and similar one-off costs.", href: "/misc-charges" },
    { label: "Total invested", value: money(out.totalInvested), note: "Everything spent out of pocket so far, including inventory on its way.", strong: true },
  ];
  const back = s.moneyBack;
  const moneyBack: Line[] = [
    {
      label: "Units sold or given away",
      value: back.unitsSold.toLocaleString(),
      note: `From your orders. ${back.freeUnits.toLocaleString()} were free (Vine, replacements): their price was fully discounted.`,
    },
    { label: "Paid out by Amazon", value: money(back.payoutSettled), note: "Settled in your Amazon account after its fees, promotions and refunds." },
    {
      label: "Pending payout (estimated)",
      value: money(back.payoutPending),
      note: `${back.pendingUnits.toLocaleString()} units Amazon hasn't settled yet (it waits about a week after delivery). Estimated from the sell price and Amazon's fee estimate.`,
    },
    { label: "Amazon payout", value: money(back.payout), note: "What Amazon settles to you after its fees, before product cost.", strong: true },
  ];
  const result: Line[] = [
    { label: "Cost of units sold", value: money(r.cogsSold), note: "Landed cost of the units that left your stock, oldest shipment first." },
    { label: "Profit on units sold", value: signed(r.profitOnSold), note: "Payout minus the cost of the units sold.", tone: tone(r.profitOnSold) },
    { label: "Overhead", value: money(r.overhead), note: "Amazon charges, advertising, tools and other costs." },
    { label: "Operating profit / (loss)", value: signed(r.operating), note: "Your real result so far. Unsold stock isn't a loss: you still own it.", tone: tone(r.operating), strong: true },
    { label: "Unsold inventory", value: money(r.unsoldInventory), note: "Arrived inventory minus the cost of units already sold: cash tied up in stock." },
    { label: "Net cash position", value: signed(r.netCash), note: "Payout minus arrived inventory and overhead. Equals operating result minus unsold inventory.", tone: tone(r.netCash) },
    { label: "Net cash incl. inventory in transit", value: signed(r.netCashWithTransit), note: "Same, also counting inventory paid for that hasn't arrived.", tone: tone(r.netCashWithTransit), strong: true },
  ];

  const c = s.coverage;
  const from = [c.ordersSince, c.payoutSince].filter(Boolean).sort()[0] ?? null;
  const through = c.newestOrder ? dayInAppZone(c.newestOrder) : null;

  return (
    <>
      <div className="-mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border bg-card px-4 py-2.5 text-[13px] shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
        <span>
          <span className="text-muted-foreground">Covers </span>
          <b className="font-semibold">
            {short(from) ?? "—"} – {short(through) ?? "—"}
          </b>
        </span>
        <span className="text-muted-foreground">
          Orders synced <span className="font-medium text-foreground">{c.ordersSynced ? stamp(c.ordersSynced) : "—"}</span>
        </span>
        <span className="text-muted-foreground">
          Payouts settled through <span className="font-medium text-foreground">{short(c.latestPayout) ?? "—"}</span>
          <span className="text-xs"> (later sales are estimated until Amazon pays)</span>
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border bg-card px-4 py-4 shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
            <p className="text-[13px] font-medium text-muted-foreground">{k.label}</p>
            <p className={cn("mt-1 text-xl font-semibold tracking-tight tabular-nums", k.tone === "bad" && "text-destructive", k.tone === "good" && "text-positive")}>{k.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{k.note}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Statement title="Money out" subtitle="What you've put in" lines={moneyOut} />
        <div className="space-y-4">
          <Statement title="Money back" subtitle="What Amazon has paid you" lines={moneyBack} />
          <Coverage s={s} />
        </div>
        <Statement title="Result" subtitle="Is it profit yet?" lines={result} />
      </div>

      <section className="space-y-3">
        <SectionHeader title="By product" meta="Profit per unit and break-even, selling only that product" />
        <div className="overflow-x-auto rounded-lg border bg-card shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
          <table className="w-full min-w-[880px] text-[13px]">
            <thead className="bg-canvas text-xs text-muted-foreground">
              <tr className="border-b [&>th]:px-4 [&>th]:py-2.5 [&>th]:font-medium">
                <th className="text-left">Product</th>
                <th className="text-right">Units sold</th>
                <th className="text-right">Payout / unit</th>
                <th className="text-right">Cost / unit</th>
                <th className="text-right">Profit / unit</th>
                <th className="text-right">In stock</th>
                <th className="text-right" title="More units of only this product needed to bring the operating result to zero">
                  To cover loss
                </th>
                <th className="text-right" title="More units of only this product until the cash you get back equals everything spent, including inventory on its way">
                  To recover investment
                </th>
              </tr>
            </thead>
            <tbody>
              {s.products.map((p) => (
                <tr key={p.asin} className="border-b last:border-0 [&>td]:px-4 [&>td]:py-2.5">
                  <td>
                    <span className="flex items-center gap-2">
                      <ProductThumb src={p.imageUrl} size={28} />
                      <span className="min-w-0">
                        <span className="block max-w-[300px] truncate font-medium" title={p.title}>
                          {p.title}
                        </span>
                        <span className="text-[11px] text-muted-foreground">{p.basedOn === "sales" ? "Based on actual sales" : "Estimate: no sales yet (today's price and fees)"}</span>
                      </span>
                    </span>
                  </td>
                  <td className="text-right tabular-nums">
                    {p.unitsSold.toLocaleString()}
                    {p.unitsSold > p.paidUnits && <span className="block text-[11px] text-muted-foreground">{(p.unitsSold - p.paidUnits).toLocaleString()} free</span>}
                  </td>
                  <td className="text-right tabular-nums">{money(p.payoutPerUnit)}</td>
                  <td className="text-right tabular-nums">{money(p.unitCost)}</td>
                  <td className={cn("text-right font-medium tabular-nums", p.profitPerUnit != null && (p.profitPerUnit < 0 ? "text-destructive" : "text-positive"))}>
                    {p.profitPerUnit == null ? "—" : signed(p.profitPerUnit)}
                  </td>
                  <td className="text-right tabular-nums">{p.inStock.toLocaleString()}</td>
                  <Units n={p.toCoverOperating} stock={p.inStock} />
                  <Units n={p.toRecoverInvestment} stock={p.inStock} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Free units (Vine, replacements) are left out of payout per unit. Red counts need more units than you have in stock. &quot;n/a&quot; means each unit loses
          money, so selling more won&apos;t close the gap.
        </p>
      </section>
    </>
  );
}

function Units({ n, stock }: { n: number | null; stock: number }) {
  return <td className={cn("text-right tabular-nums", n != null && n > stock && "text-destructive")}>{n == null ? "n/a" : n === 0 ? "Done" : n.toLocaleString()}</td>;
}

function Statement({ title, subtitle, lines }: { title: string; subtitle: string; lines: Line[] }) {
  return (
    <section className="rounded-lg border bg-card shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
      <div className="border-b px-4 py-3">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <dl className="divide-y">
        {lines.map((l) => (
          <div key={l.label} className={cn("px-4 py-2.5", l.strong && "bg-canvas/60")}>
            <div className="flex items-baseline justify-between gap-3">
              <dt className={cn("text-[13px]", l.strong ? "font-semibold" : "font-medium")}>
                {l.href ? (
                  <Link href={l.href} className="hover:text-brand">
                    {l.label}
                  </Link>
                ) : (
                  l.label
                )}
              </dt>
              <dd className={cn("text-[13px] tabular-nums", l.strong ? "font-semibold" : "font-medium", l.tone === "bad" && "text-destructive", l.tone === "good" && l.strong && "text-positive")}>
                {l.value}
              </dd>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{l.note}</p>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Coverage({ s }: { s: Awaited<ReturnType<typeof getSummary>> }) {
  const c = s.coverage;
  return (
    <section className="rounded-lg border border-dashed bg-card px-4 py-3 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">Where these numbers come from</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-4">
        <li>Orders from {short(c.ordersSince) ?? "—"} and Amazon payouts from {short(c.payoutSince) ?? "—"} onward, synced from Seller Central.</li>
        <li>
          Newest order {c.newestOrder ? stamp(c.newestOrder) : "—"}; orders last synced {c.ordersSynced ? stamp(c.ordersSynced) : "—"}; latest payout{" "}
          {short(c.latestPayout) ?? "—"} (Amazon pays about a week after delivery).
        </li>
        <li>
          Inventory from your <Link href="/shipments" className="text-brand hover:text-brand-dark">shipments</Link>; overhead from{" "}
          <Link href="/misc-charges" className="text-brand hover:text-brand-dark">misc charges</Link>.
        </li>
        {c.otherCurrencies.length > 0 && <li>Sales paid in {c.otherCurrencies.join(" and ")} count as units but aren&apos;t added to USD money.</li>}
      </ul>
    </section>
  );
}

function SummarySkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[92px] rounded-lg" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-96 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
