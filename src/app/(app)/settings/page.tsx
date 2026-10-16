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

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage(props: PageProps<"/settings">) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Connect your accounts, set the schedule, and see recent runs.</p>
      </div>
      <Suspense fallback={<div className="card h-64 animate-pulse" />}>
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
    <div className="grid items-start gap-6 lg:grid-cols-2">
      {unreviewed > 0 && (
        <a href="#security" className="block rounded-2xl bg-coral-soft px-4 py-3 text-sm font-semibold text-[#b4402f] lg:col-span-2">
          {unreviewed} security event{unreviewed === 1 ? "" : "s"} to review: see the Security log below. Your incident response plan asks you to act within 24 hours.
        </a>
      )}
      {(connected || error) && (
        <div
          className={`rounded-2xl px-4 py-3 text-sm font-semibold lg:col-span-2 ${error ? "bg-coral-soft text-[#b4402f]" : "bg-brand-soft text-brand-dark"}`}
        >
          {error ?? (connected === "seller" ? "Seller Central connected. Click “Sync Amazon data” to pull your data." : "Amazon Ads connected. Click “Sync Amazon data” to pull your ad reports.")}
        </div>
      )}

      <section id="connect" className="scroll-mt-20 space-y-4 lg:col-span-2">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">Connect your Amazon accounts</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            You sign in on Amazon&apos;s own page and approve access; SellerDoos never sees your password. Amazon requires a developer app for this, which
            you register once (that&apos;s the part tools like SoldScope do for their customers). Keys and tokens are stored only in SellerDoos&apos; local
            database.
          </p>
        </div>
        {!secure && (!spApi || !ads) && (
          <div className="rounded-2xl border border-gold/30 bg-[#fdf6ea] px-4 py-3 text-sm">
            Amazon only returns you to a secure (https) address. To connect, stop the app and run <code className="font-mono">npm run dev:https</code>, then open{" "}
            <code className="font-mono">https://localhost:3000/settings</code>. After connecting you can go back to <code className="font-mono">npm start</code>.
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
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
            title="Amazon Ads"
            subtitle="Ad spend, ad sales, ACoS and customer search terms (Amazon Ads API)"
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
      </section>

      {!ads && (
        <section id="ads-upload" className="scroll-mt-20 card space-y-4 p-6 lg:col-span-2">
          <div>
            <h2 className="font-extrabold">Upload Amazon Ads reports</h2>
            <p className="text-sm text-muted-foreground">
              Until the Ads API is connected, download reports from Amazon Ads and upload them here. They fill the Dashboard&apos;s Advertising section,
              ACoS on Products and search terms, replacing the sample data.
            </p>
          </div>
          <AdsUpload marketplaces={adsUploadMarketplaces} />
        </section>
      )}

      <section id="rank-data" className="scroll-mt-20 card space-y-5 p-6">
        <div>
          <h2 className="font-extrabold">Keyword rank data</h2>
          <p className="text-sm text-muted-foreground">
            Amazon doesn&apos;t share keyword ranks, so these come from a search results provider.
            {provider.isDemo ? " With neither connected, ranks are made-up demo data." : ` Using ${provider.label}.`}
          </p>
        </div>
        <div className="space-y-3">
          <StatusLine ok={provider.id === "dataforseo"} title="DataForSEO (recommended): ranks and search volume, pay as you go" />
          <CredentialForm group="dataforseo" fields={[field("DATAFORSEO_LOGIN", "API login"), field("DATAFORSEO_PASSWORD", "API password", true)]} />
          {isDataForSeoConfigured() && !fromEnvironment("DATAFORSEO_LOGIN") && <DisconnectButton group="dataforseo" label="Remove keys" />}
        </div>
        <div className="space-y-3 border-t border-line pt-5">
          <StatusLine
            ok={provider.id === "rainforest"}
            title={`Rainforest API (alternative)${provider.id === "dataforseo" ? ": not used while DataForSEO is connected" : ""}`}
          />
          <CredentialForm group="rainforest" fields={[field("RAINFOREST_API_KEY", "API key", true)]} />
          {getCredential("RAINFOREST_API_KEY") && !fromEnvironment("RAINFOREST_API_KEY") && <DisconnectButton group="rainforest" label="Remove key" />}
        </div>
      </section>

      <section id="schedule" className="scroll-mt-20 card space-y-5 p-5">
        <h2 className="font-semibold">Schedule</h2>
        <SettingsForm settings={getSettings()} provider={provider.id} researchSeeds={researchSeeds} />
        <div className="border-t border-line pt-5">
          <RunButtons isDemo={hasDemo} />
        </div>
      </section>

      <section id="data" className="scroll-mt-20 card space-y-4 p-6 lg:col-span-2">
        <div>
          <h2 className="font-extrabold">Data</h2>
          <p className="text-sm text-muted-foreground">Back up or move everything SellerDoos holds.</p>
        </div>
        <DataControls />
      </section>

      <section id="security" className="scroll-mt-20 card space-y-4 p-6 lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-extrabold">Security log</h2>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Rejected logins, refused API access and suspicious connect attempts are recorded here. Saved keys and tokens are encrypted; the
              encryption key is kept separately at <code className="font-mono text-xs">{keyFileLocation()}</code>. What to do when something
              appears is in <code className="font-mono text-xs">docs/incident-response-plan.md</code>.
            </p>
          </div>
          {unreviewed > 0 && <AcknowledgeSecurityButton />}
        </div>
        {events.length ? (
          <ul className="divide-y divide-line text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-4 gap-y-1 py-2">
                <span className="w-36 shrink-0 tabular-nums text-muted-foreground">{e.at}</span>
                <span className={`w-36 shrink-0 font-semibold ${e.acknowledged || e.kind === "disconnected" ? "text-muted-foreground" : "text-coral"}`}>
                  {SECURITY_LABELS[e.kind] ?? e.kind}
                </span>
                <span className="min-w-0 flex-1 text-muted-foreground">{e.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing recorded.</p>
        )}
      </section>

      <section id="runs" className="scroll-mt-20 card p-5 lg:col-span-2">
        <h2 className="mb-3 font-semibold">Recent runs</h2>
        {runs.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Started</th>
                <th className="py-2 font-medium">Type</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {runs.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap py-2 pr-4 tabular-nums">{r.started_at}</td>
                  <td className="py-2 pr-4 capitalize">{r.kind}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.status === "ok"
                          ? "bg-brand-soft text-brand"
                          : r.status === "running"
                            ? "bg-brand-soft text-brand"
                            : r.status === "partial"
                              ? "bg-[#fdf1dc] text-[#8a5a12]"
                              : "bg-coral-soft text-coral"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="whitespace-pre-line py-2 text-xs text-muted-foreground">{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing has run yet.</p>
        )}
        {queue.length > 0 && (
          <>
            <h3 className="mb-1 mt-8 text-sm font-semibold">Amazon report queue</h3>
            <p className="mb-3 text-xs text-muted-foreground">Amazon builds reports in the background; SellerDoos requests them within rate limits and collects them every few minutes.</p>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">Report</th>
                  <th className="py-2 font-medium">For</th>
                  <th className="py-2 font-medium">Period</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {queue.map((q) => (
                  <tr key={`${q.kind}-${q.scope}-${q.period_start}-${q.period_end}`} className="align-top">
                    <td className="py-2 pr-4">{REPORT_NAMES[q.kind] ?? q.kind}</td>
                    <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">{reportScope(q.kind, q.scope)}</td>
                    <td className="whitespace-nowrap py-2 pr-4 tabular-nums text-muted-foreground">
                      {q.period_start === q.period_end ? q.period_start : `${q.period_start} → ${q.period_end}`}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          q.status === "done" ? "bg-brand-soft text-brand" : q.status === "failed" ? "bg-coral-soft text-coral" : "bg-canvas text-muted-foreground"
                        }`}
                      >
                        {q.status === "queued" ? "waiting" : q.status === "pending" ? "Amazon is building" : q.status}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">{q.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
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
    <p className="flex items-center gap-2 text-sm font-semibold">
      <Icon className={`size-5 shrink-0 ${ok ? "text-brand" : "text-muted-foreground"}`} /> {title}
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
    <div className={`card space-y-5 p-6 ${props.connected ? "ring-2 ring-brand/30" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-extrabold">{props.title}</h3>
          <p className="text-sm text-muted-foreground">{props.subtitle}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${props.connected ? "bg-brand text-white" : "bg-canvas text-muted-foreground"}`}>
          {props.connected ? "Connected" : "Not connected"}
        </span>
      </div>

      {props.connected ? (
        <div className="space-y-3">
          <p className="text-sm text-brand-dark">{props.detail}</p>
          {props.extra}
          <div className="flex flex-wrap gap-2">
            <a href={props.connectHref} className="btn">
              Reconnect
            </a>
            <DisconnectButton group={props.group} />
          </div>
        </div>
      ) : (
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink">
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
        <summary className="cursor-pointer text-sm font-semibold text-muted-foreground hover:text-ink">App keys</summary>
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
