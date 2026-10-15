import { importAdsReport, type AdsUploadResult } from "@/lib/ads-upload";
import { isMarketplace } from "@/lib/marketplaces";
import { unauthorized } from "@/lib/session";

/** Uploads one or more Sponsored Products reports downloaded from the Amazon Ads console (Settings → Amazon Ads). */
export async function POST(request: Request) {
  const denied = await unauthorized();
  if (denied) return denied;
  const form = await request.formData().catch(() => null);
  const marketplace = String(form?.get("marketplace") ?? "US");
  if (!isMarketplace(marketplace)) return Response.json({ error: "Pick a marketplace." }, { status: 400 });
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return Response.json({ error: "Choose at least one report file." }, { status: 400 });

  const imported: AdsUploadResult[] = [];
  const errors: string[] = [];
  for (const file of files) {
    if (file.size > 50 * 1024 * 1024) {
      errors.push(`${file.name}: too large.`);
      continue;
    }
    try {
      imported.push(importAdsReport(new Uint8Array(await file.arrayBuffer()), file.name, marketplace));
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  return Response.json({ imported, errors }, { status: imported.length ? 200 : 400 });
}
