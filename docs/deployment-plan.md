# Deploying SellerDoos on Render

**Goal:** SellerDoos online at `https://sellerdoos.kidbeestoys.com`, protected by a password and an authenticator code, for about **$7.25 a month**:
- Render Starter plan: $7. It's always on, so the Amazon sync keeps running.
- A 1 GB disk for the database: $0.25.

**How it fits together:**
- Render builds SellerDoos from your **private GitHub repository** using the included `Dockerfile` and `render.yaml`.
- Render provides HTTPS and the custom domain.
- Your data stays in the same SQLite database file as today, on a Render disk that's snapshotted daily.
- Secrets (login, session, encryption key) are entered once in Render's dashboard. They're never in the code or the database.

Allow about 45 minutes. Commands to type are in grey boxes.

---

## 1. Create your login secrets (on your Mac, 2 minutes)

```bash
cd ~/Documents/code/SellerDoos
npm run auth:setup
```

- Choose a password of 12+ characters.
- Add SellerDoos to your authenticator app with the setup key it shows.
- This creates `.env.production`. Only you can read it, and it's never committed. It holds the four values Render will ask for, including your encryption key, so the server can read your saved Amazon connection.

## 2. Make a backup of your current data (on your Mac, 1 minute)

1. Start SellerDoos locally as usual (`npm run dev:https`).
2. Open **Settings → Data → Download backup**.

This gives one consistent file, for example `sellerdoos-2026-10-15.db`. Use it rather than copying `data/sellerdoos.db`, because that file may not include the latest changes yet.

## 3. Put the code on GitHub (5 minutes)

1. On **github.com**, click **New repository** and name it `sellerdoos`.
   - Choose **Private**.
   - Don't add a README.
   - Click **Create**.
2. On your Mac, replace `YOUR-USER` with your GitHub username:

```bash
cd ~/Documents/code/SellerDoos
git add -A
git status          # check: no data/, .env.production or certificates/ in the list
git commit -m "SellerDoos"
git branch -M main
git remote add origin https://github.com/YOUR-USER/sellerdoos.git
git push -u origin main
```

Your database, secrets and local certificates are excluded by `.gitignore`. Only code goes to GitHub.

## 4. Create the service on Render (10 minutes, plus about 5 minutes to build)

1. Sign up at **render.com** with your GitHub account, and allow access to the `sellerdoos` repository.
2. Click **New → Blueprint**, pick `sellerdoos`, and click **Connect**. Render reads `render.yaml` and shows one web service with a 1 GB disk.
3. It asks for four values. Copy each from `.env.production` (open it with `cat .env.production`):
   - `SELLERDOOS_PASSWORD_HASH`
   - `SELLERDOOS_TOTP_SECRET`
   - `SESSION_SECRET`
   - `SELLERDOOS_KEY`
4. Add a payment method if asked (the Starter plan), then click **Apply**.
5. Wait for the deploy to show **Live**. Open the `https://sellerdoos-xxxx.onrender.com` link shown at the top. You should see the SellerDoos sign-in page.

## 5. Use your own address (10 minutes)

1. In Render, open the service → **Settings → Custom Domains**. `sellerdoos.kidbeestoys.com` is already listed and shows a DNS target such as `sellerdoos-xxxx.onrender.com`.
2. At your domain's DNS provider, add a **CNAME** record:
   - **Name:** `sellerdoos`
   - **Value:** that target
3. Back in Render, click **Verify**. HTTPS is issued automatically within a few minutes.

## 6. Bring your data over (5 minutes)

1. Open `https://sellerdoos.kidbeestoys.com` (or the onrender.com link) and sign in with your password and authenticator code.
2. Go to **Settings → Data → Restore from a backup**, choose the file from step 2, tick the confirmation, and click **Restore**.
3. SellerDoos restarts with your data. Reload after about a minute.
   - If it isn't back after 2 minutes, click **Manual Deploy → Restart service** in Render.
4. Check that Summary, Shipments and Misc charges match your Mac. Then go to **Settings → Seller Central → Test connection**.

From now on, the Render copy is the "real" SellerDoos. If you still run it on your Mac, start it with `DISABLE_SCHEDULER=true npm run dev:https`, so two copies don't sync with Amazon.

## 7. Tell Amazon the new address (10 minutes)

**Seller Central app** (sellercentral.amazon.com → Apps & Services → Develop Apps → SellerDoos → Edit App):
- OAuth Login URI: `https://sellerdoos.kidbeestoys.com/settings`
- OAuth Redirect URI: `https://sellerdoos.kidbeestoys.com/api/amazon/callback/seller`

Your current connection keeps working; this only matters if you reconnect.

**Login with Amazon security profile** (for Ads; developer.amazon.com → Login with Amazon):
- Consent Privacy Notice URL: `https://sellerdoos.kidbeestoys.com/privacy`
- Web Settings → Allowed Origins: `https://sellerdoos.kidbeestoys.com`
- Web Settings → Allowed Return URLs: `https://sellerdoos.kidbeestoys.com/api/amazon/callback/ads`

Then apply for Amazon Ads API access. Once approved, go to **Settings → Amazon Ads → Connect**.

---

## Everyday use

- **Updates:** push to GitHub (`git push`) and Render rebuilds and redeploys automatically. Your data on the disk isn't touched.
- **Backups:**
  - Render snapshots the disk daily. Restore one under the service's **Disks** tab.
  - For an extra copy you control, use **Settings → Data → Download backup** now and then.
- **Moving or recovering:** **Settings → Data → Restore** works on any copy of SellerDoos, as long as it uses the same `SELLERDOOS_KEY`.
- **Sign-ins and security:** failed sign-ins, backups and restores are listed in **Settings → Security**.
- **Changing your password or authenticator:**
  1. Run `npm run auth:setup` again.
  2. Update the three login values in Render → **Environment**. Keep `SELLERDOOS_KEY` the same.
  3. Save. Render redeploys and everyone is signed out.

## What's in place for security

- **Login:** a password (scrypt-hashed) plus an authenticator code.
  - After 5 failures from one address, sign-ins pause for 15 minutes.
  - Sessions last 7 days, in a cookie the browser's scripts can't read.
- **Server-side checks:** every page, button and API is checked on the server. Only `/login`, `/privacy` and `/api/health` are public.
- **If misconfigured:** without login settings, the production app refuses to run (503) rather than run unprotected.
- **Encryption in transit:** HTTPS only, with HSTS.
- **Headers:** pages can't be embedded in other sites, and search engines index only `/privacy`.
- **Encryption at rest:** Amazon tokens are encrypted with AES-256-GCM, using a key kept in Render's environment settings. A copy of the database alone exposes nothing.
- **Container:** the app runs as a normal user, never as root.

## Running it somewhere else

The same image runs on any Docker host. `docker-compose.yml`, the `Caddyfile` (automatic HTTPS) and `scripts/backup.sh` (nightly copy to S3) are included, for example for an AWS Lightsail or Hetzner server: `docker compose up -d --build` with `.env.production` next to it.

## Later: opening SellerDoos to other sellers

| Today | When going public |
|---|---|
| SQLite on one Render disk (one server) | PostgreSQL (Render Postgres or AWS RDS), with every table tagged by seller account and row-level security. Several app servers and separate sync workers. |
| Built-in single-owner login (`src/lib/auth.ts`) | A hosted identity service (Amazon Cognito or similar): sign-up, required MFA, many users |
| Encryption key in an environment variable | A managed key service (AWS KMS) with rotation |
| Render web service | Render with Postgres, or AWS ECS + load balancer + WAF. Same Docker image. |
| Security log in Settings | Centralised logs, threat detection, vulnerability scans and a yearly penetration test, for Amazon's Data Protection Policy review |
