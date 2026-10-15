import type { Metadata } from "next";
import { Logo } from "@/components/Logo";

// Public privacy notice (linked from Amazon's consent screens). It sits outside the (app) group, so it
// shows no menu and no business data.

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "How SellerDoos handles data from Amazon Seller Central and Amazon Ads.",
};

const EFFECTIVE = "October 15, 2026";
const CONTACT = "contact@kidbeestoys.com";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-6 py-4 text-[15px] font-semibold tracking-tight">
          <Logo size={22} /> SellerDoos
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <article className="space-y-8 rounded-lg border bg-card px-6 py-8 text-[14px] leading-relaxed text-foreground/90 shadow-[0_1px_2px_0_rgba(16,24,40,0.04)] sm:px-10">
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Privacy notice</h1>
            <p className="text-[13px] text-muted-foreground">Effective {EFFECTIVE}</p>
          </header>

          <Section title="Who we are">
            <p>
              SellerDoos is an internal reporting tool operated by KidBees (&quot;we&quot;, &quot;us&quot;) for managing our own Amazon store. It is not offered to other
              sellers or to the public. When you connect SellerDoos to Amazon Seller Central or Amazon Ads, Amazon asks you to approve access; this notice
              explains what that access is used for.
            </p>
          </Section>

          <Section title="What data SellerDoos accesses">
            <p>Only data from the Amazon accounts that we connect ourselves, through Amazon&apos;s official APIs:</p>
            <ul>
              <li>
                <b>Seller Central (Selling Partner API):</b> our listings, prices, fee estimates, FBA inventory levels, order lines (order number, product, quantity,
                price, status and dates), settlement and fee transactions, and Brand Analytics and Sales &amp; Traffic reports.
              </li>
              <li>
                <b>Amazon Ads (Amazon Ads API):</b> performance of our own Sponsored Products campaigns, such as impressions, clicks, spend, sales and the search terms
                that triggered our ads.
              </li>
            </ul>
            <p>
              SellerDoos does <b>not</b> request or store shoppers&apos; personal information: no buyer names, addresses, email addresses or phone numbers. It
              never sees Amazon passwords; access works through tokens that Amazon issues after you approve it.
            </p>
          </Section>

          <Section title="How the data is used">
            <p>
              Solely to show our own business performance to us: sales, advertising results, inventory, cost of goods and profit. The data is not used for
              advertising to anyone, not sold, and not combined with data about other sellers.
            </p>
          </Section>

          <Section title="Sharing">
            <p>
              We do not sell, rent or share Amazon data with anyone. The only outside service SellerDoos may contact is a search-ranking provider, which
              receives the search keywords and product numbers (ASINs) we choose to track, never account, order or financial data.
            </p>
          </Section>

          <Section title="Storage and security">
            <ul>
              <li>Data is stored in a private database on a server we control, reachable only over encrypted connections (HTTPS).</li>
              <li>Amazon access tokens and API keys are encrypted at rest (AES-256-GCM) and are never shown in the app.</li>
              <li>Access to SellerDoos is limited to KidBees staff who need it.</li>
              <li>Failed sign-ins, refused API access and connection changes are logged and reviewed under our incident response plan.</li>
            </ul>
          </Section>

          <Section title="Retention and deletion">
            <p>
              We keep data only while it&apos;s needed to run our business. Disconnecting Seller Central or Amazon Ads in SellerDoos&apos;s settings deletes the
              stored access tokens immediately, and access can also be revoked at any time from your Amazon account settings. Stored reports are deleted on
              request.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions or requests about this notice: <a href={`mailto:${CONTACT}`} className="font-medium text-brand hover:text-brand-dark">{CONTACT}</a>
            </p>
          </Section>
        </article>
        <p className="mt-6 text-center text-xs text-muted-foreground">© {new Date(EFFECTIVE).getFullYear()} KidBees</p>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
      <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}
