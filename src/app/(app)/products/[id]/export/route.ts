import { unauthorized } from "@/lib/session";
import { getProductDetail } from "@/lib/queries";

// CSV of every keyword's organic and sponsored rank per day, plus SQP numbers.
export async function GET(request: Request, ctx: RouteContext<"/products/[id]/export">) {
  const denied = await unauthorized();
  if (denied) return denied;
  const { id } = await ctx.params;
  const range = Math.min(Math.max(Number(new URL(request.url).searchParams.get("range")) || 30, 1), 365);
  const detail = await getProductDetail(Number(id), range);
  if (!detail) return new Response("Not found", { status: 404 });

  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "keyword",
    "tags",
    "monthly_searches",
    "volume_source",
    "sqp_asin_impressions",
    "sqp_asin_clicks",
    "sqp_asin_cart_adds",
    "sqp_asin_purchases",
    ...detail.dates.flatMap((d) => [`${d}_organic`, `${d}_sponsored`]),
  ];
  const rows = detail.keywords.map((k) => [
    k.keyword,
    k.tags,
    k.volume,
    k.volumeSource,
    k.sqp?.asin_impressions,
    k.sqp?.asin_clicks,
    k.sqp?.asin_cart_adds,
    k.sqp?.asin_purchases,
    ...detail.dates.flatMap((d) => [k.ranks[d]?.organic, k.ranks[d]?.sponsored]),
  ]);
  const csv = [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${detail.product.asin}-ranks-${detail.dates.at(-1)}.csv"`,
    },
  });
}
