# SellerDoos

Your daily Amazon keyword briefing. SellerDoos tracks where your products rank for the searches that matter, then tells you in plain language what moved, where you stand and what to do next. It also brings in Best Sellers Rank and Amazon's Search Query Performance (SQP) data for your own ASINs.

## Run it

```bash
npm install
npm run dev                  # http://localhost:3000
```

Then open **Settings** to connect your accounts. No config files needed (`.env.local` still works if you prefer it; see `.env.example`).

For everyday use, run the production build so the daily checks keep going in the background:

```bash
npm run build
npm start
```

Data is stored in `data/sellerdoos.db` (SQLite). Back up that file to keep your history.

Without any keys, SellerDoos runs in **demo mode** with made-up ranks so you can try it. Clear the demo rows from Settings once you connect real data.

## Data sources

| Data | Source | Setting in `.env.local` |
| --- | --- | --- |
| Organic and sponsored keyword rank | [DataForSEO](https://dataforseo.com) Merchant API › Amazon › Products (recommended), or [Rainforest API](https://www.rainforestapi.com) | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` (or `RAINFOREST_API_KEY`) |
| Estimated monthly search volume | DataForSEO Labs › Amazon › Bulk Search Volume | same DataForSEO login |
| Sales, sessions, conversion, Buy Box % per ASIN per day | SP-API Sales & Traffic report (Brand Analytics) | `SPAPI_CLIENT_ID`, `SPAPI_CLIENT_SECRET`, `SPAPI_REFRESH_TOKEN` |
| Orders | SP-API all-orders report (no customer data stored) | same |
| Amazon fees, refunds, payouts → profit | SP-API Finances API, plus your cost per unit | same |
| FBA stock, days of cover | SP-API FBA Inventory API | same |
| BSR, title, image (yours and competitors') | SP-API Catalog Items API | same |
| Buy Box price, lowest price, seller count | SP-API Product Pricing API | same |
| Search Query Performance, Top Search Terms | SP-API Brand Analytics reports (Brand Registry) | same |
| Ad spend, ad sales, ACoS, customer search terms | Amazon Ads API (Sponsored Products reports v3) | `ADS_CLIENT_ID`, `ADS_CLIENT_SECRET`, `ADS_REFRESH_TOKEN` |

Anything not connected shows **sample data** (marked "demo" in the app), so every screen can be explored first. **Settings › Clear demo data** removes it; real data from Amazon is kept.

### Costs

- **DataForSEO** charges per search, per 100 results. The default (2 pages, top 100 results) is one charge per keyword per day, about $0.001 on the standard queue, so 50 keywords cost roughly $1.50 a month. Search volume is fetched once for new keywords and refreshed monthly. There's no subscription; DataForSEO asks for a $50 minimum deposit.
- **Rainforest** charges per results page on a monthly plan. SellerDoos stops scanning once it finds the product.
- **Amazon's APIs** (SP-API and Ads API) are free.

With DataForSEO, searches are queued: **Check now** waits up to 90 seconds, and anything still processing is collected automatically every 5 minutes.

Search volume shown in SellerDoos is monthly. It comes from your own SQP report when available (weekly × 52/12), otherwise from DataForSEO's estimate (marked with ~). DataForSEO has no volume data for Amazon Japan.

### Connecting your Amazon accounts

You connect by signing in on Amazon's own page and approving access; SellerDoos never sees your password. Amazon only allows this through a developer app, which you register once. (Tools like SoldScope register one app for all their customers, which is why their users only see a Connect button. With SellerDoos you are the developer.)

Amazon only sends you back to a secure address, so connect while running **`npm run dev:https`** and open `https://localhost:3000/settings`. The first time, macOS asks for your password to trust a local certificate. After connecting you can go back to `npm start`; the connection is saved.

**Seller Central (SP-API):**
1. In Seller Central, **Apps & Services › Develop Apps**, register as a developer.
2. Add a **public** app (it can stay in Draft) with the roles: Brand Analytics, Selling Partner Insights, Product Listing, Pricing, Inventory and Order Tracking, Finance and Accounting.
3. Set its OAuth Login URI and Redirect URI to `https://localhost:3000/api/amazon/callback/seller` (shown with a copy button in Settings).
4. In SellerDoos Settings, paste the App ID and LWA client ID and secret, save, then click **Connect Seller Central**.

**Amazon Ads:**
1. Apply for Amazon Ads API access at advertising.amazon.com/API.
2. In the Login with Amazon console, create a security profile and add `https://localhost:3000/api/amazon/callback/ads` to its Allowed Return URLs.
3. In Settings, paste its client ID and secret, save, then click **Connect Amazon Ads**. SellerDoos finds your seller profile for each marketplace automatically.

If Amazon won't accept a `localhost` address in your app registration, use a tunnel (for example a free Cloudflare Tunnel) that gives an https URL, register that, and open Settings through it.

Keys and tokens are stored only in the local database (`data/sellerdoos.db`); Settings never shows secrets back. **Disconnect** removes the connection.

### How Amazon data is collected

- **Reports** (Sales & Traffic, orders, SQP, Top Search Terms, Ads) are built by Amazon in the background. SellerDoos queues them, requests them within Amazon's rate limits (Sales & Traffic: about 3 every 5 minutes), and collects them every 5 minutes. Settings shows the queue.
- On first connect it backfills 30 days of sales and orders and 60 days of ads, so it can take an hour or two for everything to arrive.
- Inventory, finances, BSR and prices are fetched directly with each daily run, or with **Sync Amazon data** (Business page or Settings).
- Top Search Terms is millions of rows, so it's streamed and only searches containing your keyword words (or Settings › research seed words), or where you or a watched competitor are a top click, are kept.
- **Profit** = sales + promotions + Amazon fees + refunds + adjustments − ad spend − your cost per unit × units shipped, using what Amazon posted to your account. Tax is excluded (Amazon collects and remits it in most marketplaces).

### Testing without credentials

`npm run test:connect` (after `npm run build`) clicks through both Connect flows against the running app and the mock, including refusing forged callbacks, then syncs with the saved tokens.

`npm run test:amazon` runs every Amazon job against a local imitation of Amazon's APIs (`scripts/mock-amazon.mjs`, shaped like Amazon's published API models) and checks what's stored, including throttling, paging, gzip, streaming and the profit maths.

## How it works

- **Daily check:** while the app is running, it checks every 15 minutes whether today's run is due (after the hour set in Settings) and runs it once a day. **Check now** on a product runs it on demand.
- **Ranks:** organic rank counts only non-sponsored results, and sponsored rank counts only ads. A blank means the product wasn't found within the pages scanned.
- **Organic visibility score:** an estimate of how much search traffic you capture compared with ranking #1 for every keyword, weighted by SQP search volume where available.
- **Search volume:** comes from your SQP report, so only queries where your ASIN appeared have a number.
- **Overview:** a weekly briefing (compared with 7 days earlier), the biggest winners and losers, opportunities (SQP queries you don't track yet, or keywords just past page 1) and how many keywords sit in Top 3, Page 1, Page 2 or beyond.
- **Page 1:** treated as the top 48 organic results, which is roughly one Amazon search page.
- **Keywords:** a list with a rank badge, 7-day change and trend line for each keyword, or a daily grid. Switch between organic and sponsored ranks.
- **Search queries:** every query from the latest SQP week. Click **Track** to add one as a keyword.
- **Sales & profit, Ads, Competitors:** per-product tabs. **Research** (Top Search Terms) and **Business** (account-wide sales, profit by product, FBA stock, recent orders) are top-level pages.

## Code map

| Path | What it does |
| --- | --- |
| `src/lib/serp/` | Search results providers (Rainforest, demo). Add another provider here. |
| `src/lib/amazon/` | Amazon clients: login and retries (`http.ts`), SP-API (`spapi.ts`), Ads API (`ads.ts`) |
| `src/lib/jobs/` | Rank checks, the Amazon report queue, direct syncs, demo data, and the daily job |
| `src/lib/queries.ts`, `src/lib/commerce.ts` | Read queries for pages |
| `src/lib/profit.ts` | Profit calculation |
| `scripts/` | Amazon API imitation and end-to-end test |
| `src/instrumentation.ts` | Starts the daily scheduler |
| `src/app/actions.ts` | Server Actions (add product, keywords, check now, settings) |

## Security

- SellerDoos has no login. Run it only on your own computer (`localhost`), or add authentication before putting it on the internet.
- Saved keys and tokens are encrypted (AES-256-GCM). The key is kept separately at `~/.sellerdoos/master.key` and is readable only by your user account. Back it up together with `data/sellerdoos.db`, or you'll need to reconnect after restoring.
- **Settings › Security log** records rejected logins, refused API access, connect attempts that didn't start in the app, and decryption failures. Unreviewed events show a red banner.
- `docs/incident-response-plan.md` is the plan you described to Amazon in your developer profile. Fill in the blanks (name, contact, dates), follow it, and review it every 6 months.
- On your Mac: turn on the Firewall (System Settings › Network) and FileVault (System Settings › Privacy & Security), and keep macOS updated.
