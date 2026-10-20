import { AdsUpload } from "@/components/AdsUpload";
import { DataControls } from "@/components/DataControls";
import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { CopyValue, CredentialForm, DisconnectButton, type Field } from "@/components/ConnectControls";
import { RunButtons, SettingsForm } from "@/components/SettingsControls";
import { missingAppKeys } from "@/lib/amazon/oauth";
import { fromEnvironment, getCredential, mask, type CredentialName } from "@/lib/credentials";
import { isDataForSeoConfigured } from "@/lib/dataforseo";
import { keyFileLocation } from "@/lib/secrets";
import { securityEvents, unacknowledgedCount } from "@/lib/security";
import { AcknowledgeSecurityButton, TestConnectionButton } from "@/components/ConnectControls";
import { isMarketplace, marketplaces as allMarketplaces, type MarketplaceCode } from "@/lib/marketplaces";
import { getRecentRuns, getReportQueue } from "@/lib/queries";
import { getSerpProvider } from "@/lib/serp";
import { getSettings } from "@/lib/settings";
import { isAdsConfigured } from "@/lib/amazon/ads";
import { isSpApiConfigured } from "@/lib/amazon/spapi";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { Panel, tableStyles } from "@/components/Panel";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage(props: PageProps<"/settings">) {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Connections, ad reports, schedule, backups and activity." />
      <nav aria-label="Settings sections" className="-mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="text-muted-foreground hover:text-brand">
            {s.label}
          </a>
        ))}
      </nav>
      <Suspense fallback={<Skeleton className="h-64 rounded-lg" />}>
        <SettingsContent {...props} />
      </Suspense>
    </div>
  );
}

async function SettingsContent({ searchParams }: PageProps<"/settings">) {
  const sp = await searchParams;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  // Next.js sets x-forwarded-proto to https when serving over TLS (npm run dev:https).
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = `${proto.split(",")[0]}://${host}`;
  const secure = origin.startsWith("https://");
  // The address to register with Amazon is the https one you'll connect from (npm run dev:https uses port 3000).
  const callbackOrigin = secure ? origin : "https://localhost:3000";

  const provider = getSerpProvider();
  const spApi = isSpApiConfigured();
  const ads = isAdsConfigured();
  const [runs, queue] = await Promise.all([getRecentRuns(), getReportQueue()]);
  const researchSeeds = (db.prepare("SELECT value FROM settings WHERE key = 'researchSeeds'").get() as { value: string } | undefined)?.value ?? "";
  const hasDemo = provider.isDemo || !spApi || !ads;
  const marketplace = (db.prepare("SELECT marketplace FROM products ORDER BY id LIMIT 1").get() as { marketplace: string } | undefined)?.marketplace ?? "US";
  // Marketplaces you sell in, most products first, for the ads report upload.
  const adsUploadMarketplaces = (db.prepare("SELECT marketplace, COUNT(*) n FROM products GROUP BY marketplace ORDER BY n DESC").all() as { marketplace: string }[])
    .filter((r) => isMarketplace(r.marketplace))
    .map((r) => ({ code: r.marketplace, label: `${allMarketplaces[r.marketplace as MarketplaceCode].flag} ${allMarketplaces[r.marketplace as MarketplaceCode].name}` }));
  const field = (name: CredentialName, label: string, secret = false, placeholder?: string): Field => ({
    name,
    label,
    secret,
    placeholder,
    saved: mask(getCredential(name)),
    locked: fromEnvironment(name),
  });
  const sellingIn = JSON.parse(
    (db.prepare("SELECT value FROM settings WHERE key = 'spapi:marketplaces'").get() as { value: string } | undefined)?.value ?? "[]",
  ) as { code: MarketplaceCode; storeName: string | null }[];
  const events = securityEvents();
  const unreviewed = unacknowledgedCount();
  const connected = typeof sp.connected === "string" ? sp.connected : null;
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <div className="space-y-6">
      {unreviewed > 0 && (
        <a href="#security" className="block rounded-lg border border-destructive/20 bg-coral-soft px-4 py-3 text-[13px] font-medium text-destructive">
          {unreviewed} security event{unreviewed === 1 ? "" : "s"} to review: see the Security log below. Your incident response plan asks you to act within 24 hours.
        </a>
      )}
      {(connected || error) && (
        <div
          className={`rounded-lg border px-4 py-3 text-[13px] font-medium ${error ? "border-destructive/20 bg-coral-soft text-destructive" : "border-brand/20 bg-brand-soft text-brand-dark"}`}
        >
          {error ?? (connected === "seller" ? "Seller Central connected. Click “Sync Amazon data” to pull your data." : "Amazon Ads connected. Click “Sync Amazon data” to pull your ad reports.")}
        </div>
      )}

      <Panel
        id="connect"
        title="Connections"
        meta="You sign in on Amazon's own page and approve access; SellerDoos never sees your password. Keys and tokens are stored encrypted in SellerDoos' own database."
      >
        {!secure && (!spApi || !ads) && (
          <div className="mb-4 rounded-md border border-[#f2d49b] bg-[#fdf6e7] px-3 py-2 text-[13px] text-[#7a4f0e]">
            Amazon only returns you to a secure (https) address. To connect, run <code className="font-mono">npm run dev:https</code> and open{" "}
            <code className="font-mono">https://localhost:3000/settings</code>.
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          <ConnectCard
            title="Seller Central"
            subtitle="Sales, profit, stock, BSR, prices, Search Query Performance and Top Search Terms (SP-API)"
            connected={spApi}
            detail={
              spApi
                ? sellingIn.length
                  ? `Connected${sellingIn[0].storeName ? ` to “${sellingIn[0].storeName}”` : ""}, selling in ${sellingIn.map((m) => `${allMarketplaces[m.code].flag} ${allMarketplaces[m.code].name}`).join(", ")}.`
                  : "Keys saved. Click Test connection to check them with Amazon."
                : null
            }
            extra={spApi ? <TestConnectionButton /> : null}
            steps={[
              <>In Seller Central, open <b>Apps &amp; Services → Develop Apps</b> and register as a developer.</>,
              <>
                Add a <b>public</b> app (it can stay in Draft) with roles: Brand Analytics, Selling Partner Insights, Product Listing, Pricing,
                Inventory and Order Tracking, Finance and Accounting.
              </>,
              <>If the app has OAuth Login and Redirect URI fields, set both to:</>,
              <>
                Paste the App ID and LWA client ID and secret below, save, then click Connect. No OAuth fields? Click <b>Authorize app</b> on the
                app in Seller Central instead and paste the refresh token it shows.
              </>,
            ]}
            urls={[`${callbackOrigin}/api/amazon/callback/seller`]}
            form={
              <CredentialForm
                group="seller"
                draft={getCredential("SPAPI_DRAFT") !== "false"}
                fields={[
                  field("SPAPI_APP_ID", "App ID", false, "amzn1.sp.solution…"),
                  field("SPAPI_CLIENT_ID", "LWA client ID", false, "amzn1.application-oa2-client…"),
                  field("SPAPI_CLIENT_SECRET", "LWA client secret", true),
                  field("SPAPI_REFRESH_TOKEN", "Refresh token (only if using Authorize app)", true, "Atzr|…"),
                ]}
              />
            }
            connectHref={`/api/amazon/connect/seller?marketplace=${marketplace}`}
            canConnect={secure && missingAppKeys("seller").length === 0}
            group="seller"
            note="Sales & Traffic, SQP and Top Search Terms need Brand Registry."
          />
          <ConnectCard
            title="Amazon Ads API"
            subtitle="Optional: ad numbers automatically. Without it, upload your ad reports below."
            connected={ads}
            detail={ads ? "Connected. Your seller profile is matched per marketplace automatically." : null}
            steps={[
              <>Apply for Amazon Ads API access at <b>advertising.amazon.com/API</b> (separate approval from SP-API).</>,
              <>In the Login with Amazon console, create a security profile and add this to its <b>Allowed Return URLs</b>:</>,
              <>Paste the security profile&apos;s client ID and secret below, save, then click Connect.</>,
            ]}
            urls={[`${callbackOrigin}/api/amazon/callback/ads`]}
            form={
              <CredentialForm
                group="ads"
                fields={[field("ADS_CLIENT_ID", "Client ID", false, "amzn1.application-oa2-client…"), field("ADS_CLIENT_SECRET", "Client secret", true)]}
              />
            }
            connectHref={`/api/amazon/connect/ads?marketplace=${marketplace}`}
            canConnect={secure && missingAppKeys("ads").length === 0}
            group="ads"
          />
        </div>
      </Panel>

      {!ads && (
        <Panel
          id="ads-upload"
          title="Amazon Ads reports"
          meta="Download reports from Amazon Ads and upload them here. They fill the Advertising numbers, ACoS and search terms."
        >
          <AdsUpload marketplaces={adsUploadMarketplaces} />
        </Panel>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel
          id="rank-data"
          title="Keyword rank data"
          meta={`Amazon doesn't share keyword ranks, so these come from a search results provider.${provider.isDemo ? " With neither connected, ranks are sample data." : ` Using ${provider.label}.`}`}
        >
          <div className="space-y-3">
            <StatusLine ok={provider.id === "dataforseo"} title="DataForSEO (recommended): ranks and search volume, pay as you go" />
            <CredentialForm group="dataforseo" fields={[field("DATAFORSEO_LOGIN", "API login"), field("DATAFORSEO_PASSWORD", "API password", true)]} />
            {isDataForSeoConfigured() && !fromEnvironment("DATAFORSEO_LOGIN") && <DisconnectButton group="dataforseo" label="Remove keys" />}
          </div>
          <div className="mt-5 space-y-3 border-t pt-5">
            <StatusLine
              ok={provider.id === "rainforest"}
              title={`Rainforest API (alternative)${provider.id === "dataforseo" ? ": not used while DataForSEO is connected" : ""}`}
            />
            <CredentialForm group="rainforest" fields={[field("RAINFOREST_API_KEY", "API key", true)]} />
            {getCredential("RAINFOREST_API_KEY") && !fromEnvironment("RAINFOREST_API_KEY") && <DisconnectButton group="rainforest" label="Remove key" />}
          </div>
        </Panel>

        <Panel id="schedule" title="Schedule & sync" meta="When the daily check runs, and manual syncs">
          <SettingsForm settings={getSettings()} provider={provider.id} researchSeeds={researchSeeds} />
          <div className="mt-5 border-t pt-5">
            <RunButtons isDemo={hasDemo} />
          </div>
        </Panel>
      </div>

      <Panel id="data" title="Data" meta="Back up or move everything SellerDoos holds.">
        <DataControls />
      </Panel>

      <Panel
        id="security"
        title="Security log"
        meta={
          <>
            Rejected logins, refused API access and suspicious connect attempts. Keys and tokens are encrypted; the key is kept at{" "}
            <code className="font-mono">{keyFileLocation()}</code>. What to do: <code className="font-mono">docs/incident-response-plan.md</code>.
          </>
        }
        actions={unreviewed > 0 ? <AcknowledgeSecurityButton /> : undefined}
        bodyClassName={events.length ? "p-0" : undefined}
      >
        {events.length ? (
          <ul className="divide-y text-[13px]">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-2.5">
                <span className="w-36 shrink-0 tabular-nums text-muted-foreground">{e.at}</span>
                <span className={`w-36 shrink-0 font-medium ${e.acknowledged || e.kind === "disconnected" ? "text-muted-foreground" : "text-destructive"}`}>
                  {SECURITY_LABELS[e.kind] ?? e.kind}
                </span>
                <span className="min-w-0 flex-1 text-muted-foreground">{e.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">Nothing recorded.</p>
        )}
      </Panel>

      <Panel id="runs" title="Recent runs" bodyClassName={runs.length ? "p-0" : undefined}>
        {runs.length ? (
          <div className="overflow-x-auto">
            <table className={tableStyles.table}>
              <thead className={tableStyles.head}>
                <tr className="border-b text-left">
                  <th>Started</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className={`${tableStyles.row} align-top`}>
                    <td className="whitespace-nowrap tabular-nums">{r.started_at}</td>
                    <td className="capitalize">{r.kind}</td>
                    <td>
                      <Badge tone={r.status === "ok" || r.status === "running" ? "good" : r.status === "partial" ? "warn" : "bad"}>{r.status}</Badge>
                    </td>
                    <td className="whitespace-pre-line text-xs text-muted-foreground">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">Nothing has run yet.</p>
        )}
      </Panel>

      {queue.length > 0 && (
        <Panel
          id="queue"
          title="Amazon report queue"
          meta="Amazon builds reports in the background; SellerDoos requests them within rate limits and collects them every few minutes."
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className={tableStyles.table}>
              <thead className={tableStyles.head}>
                <tr className="border-b text-left">
                  <th>Report</th>
                  <th>For</th>
                  <th>Period</th>
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((q) => (
                  <tr key={`${q.kind}-${q.scope}-${q.period_start}-${q.period_end}`} className={`${tableStyles.row} align-top`}>
                    <td>{REPORT_NAMES[q.kind] ?? q.kind}</td>
                    <td className="whitespace-nowrap text-muted-foreground">{reportScope(q.kind, q.scope)}</td>
                    <td className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {q.period_start === q.period_end ? q.period_start : `${q.period_start} → ${q.period_end}`}
                    </td>
                    <td>
                      <Badge tone={q.status === "done" ? "good" : q.status === "failed" ? "bad" : "neutral"}>
                        {q.status === "queued" ? "waiting" : q.status === "pending" ? "Amazon is building" : q.status}
                      </Badge>
                    </td>
                    <td className="text-xs text-muted-foreground">{q.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

const SECTIONS = [
  { id: "connect", label: "Connections" },
  { id: "ads-upload", label: "Ads reports" },
  { id: "rank-data", label: "Rank data" },
  { id: "schedule", label: "Schedule" },
  { id: "data", label: "Data" },
  { id: "security", label: "Security" },
  { id: "runs", label: "Activity" },
];

function Badge({ tone, children }: { tone: "good" | "warn" | "bad" | "neutral"; children: React.ReactNode }) {
  const styles = {
    good: "bg-positive-soft text-positive",
    warn: "bg-[#fdf1dc] text-[#8a5a12]",
    bad: "bg-coral-soft text-destructive",
    neutral: "bg-[#f1f3f7] text-[#545969]",
  }[tone];
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${styles}`}>{children}</span>;
}

const SECURITY_LABELS: Record<string, string> = {
  login_rejected: "Login rejected",
  access_denied: "Access denied",
  forged_callback: "Suspicious connect",
  decrypt_failed: "Decryption failed",
  disconnected: "Disconnected",
  signin_failed: "Failed sign-in",
  signin_locked: "Sign-ins paused",
  data_exported: "Backup downloaded",
  data_restored: "Data restored",
};

/** "US", "🇺🇸 US", a product's ASIN for SQP, or the marketplace for Ads ("US:<profile>"). */
function reportScope(kind: string, scope: string) {
  if (kind === "sqp") {
    const p = db.prepare("SELECT asin FROM products WHERE id = ?").get(Number(scope)) as { asin: string } | undefined;
    return p?.asin ?? `product ${scope}`;
  }
  const code = scope.split(":")[0];
  return isMarketplace(code) ? `${allMarketplaces[code].flag} ${code}` : scope;
}

const REPORT_NAMES: Record<string, string> = {
  sqp: "Search Query Performance",
  sales_traffic: "Sales & Traffic",
  orders: "Orders",
  search_terms: "Top Search Terms",
  ads_search_terms: "Ads: search terms",
  ads_products: "Ads: advertised products",
};

function StatusLine({ ok, title }: { ok: boolean; title: string }) {
  const Icon = ok ? CheckCircle2 : CircleDashed;
  return (
    <p className="flex items-center gap-2 text-[13px] font-medium">
      <Icon className={`size-4 shrink-0 ${ok ? "text-positive" : "text-muted-foreground"}`} /> {title}
    </p>
  );
}

function ConnectCard(props: {
  title: string;
  subtitle: string;
  connected: boolean;
  detail: string | null;
  steps: React.ReactNode[];
  urls: string[];
  form: React.ReactNode;
  connectHref: string;
  canConnect: boolean;
  group: "seller" | "ads";
  note?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">{props.title}</h3>
          <p className="text-xs text-muted-foreground">{props.subtitle}</p>
        </div>
        <Badge tone={props.connected ? "good" : "neutral"}>{props.connected ? "Connected" : "Not connected"}</Badge>
      </div>

      {props.connected ? (
        <div className="space-y-3">
          <p className="text-[13px] text-foreground">{props.detail}</p>
          {props.extra}
          <div className="flex flex-wrap gap-2">
            <a href={props.connectHref} className="btn">
              Reconnect
            </a>
            <DisconnectButton group={props.group} />
          </div>
        </div>
      ) : (
        <ol className="list-decimal space-y-2 pl-5 text-[13px] text-foreground">
          {props.steps.map((step, i) => (
            <li key={i} className="pl-1">
              {step}
              {i === props.steps.length - 2 && (
                <div className="mt-2 space-y-1.5">
                  {props.urls.map((u) => (
                    <CopyValue key={u} value={u} />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <details className="group" open={!props.connected}>
        <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground">App keys</summary>
        <div className="mt-3">{props.form}</div>
      </details>

      {!props.connected &&
        (props.canConnect ? (
          <a href={props.connectHref} className="btn-primary">
            Connect {props.title}
          </a>
        ) : (
          <span className="btn-primary pointer-events-none opacity-50">Connect {props.title}</span>
        ))}
      {props.note && <p className="text-xs text-muted-foreground">{props.note}</p>}
    </div>
  );
}
