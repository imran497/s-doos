# Information Security Incident Response Plan

**Organization:** KidBees (Amazon seller)
**System covered:** SellerDoos, our internal tool that reads our own Amazon Selling Partner API (SP-API) and Amazon Ads API data
**Plan owner:** [Your full name], Owner
**Security contact:** [your email] · [your phone]
**Effective date:** [date] · **Next review due:** [date + 6 months]

## 1. Purpose and scope

This plan explains how we detect, respond to, report and recover from security incidents involving Amazon Information: any data obtained through the SP-API or Amazon Ads API, plus the credentials used to get it (LWA client secrets and refresh tokens).

SellerDoos is used only for our own seller account. It reads data and doesn't change listings, prices or orders. It doesn't request or store buyer personally identifiable information (PII).

## 2. Roles and responsibilities

| Role | Who | Responsibilities |
| --- | --- | --- |
| Incident lead | Plan owner | Decides whether an event is an incident, runs this plan, contacts Amazon, keeps the incident record |
| Backup | [name, or "none: sole operator"] | Takes over if the incident lead is unreachable for more than 12 hours |
| Users | Plan owner only | Only the plan owner has access to SellerDoos and the computer it runs on |

## 3. What counts as an incident

- A credential (LWA client secret, refresh token, encryption key file) is exposed, lost, stolen or shared by mistake.
- The computer running SellerDoos is lost, stolen, infected with malware, or accessed by someone who shouldn't have access.
- SellerDoos's **Security log** shows *Login rejected*, *Access denied*, *Suspicious connect* or *Decryption failed* that we can't explain.
- Amazon notifies us of suspicious activity on our developer app or seller account.
- Amazon Information is sent anywhere other than our own computer.

## 4. Detection

- **SellerDoos Security log** (Settings → Security log). It records rejected logins, refused API access, connect attempts that didn't start in the app, and decryption failures. Unreviewed events show a red banner at the top of Settings.
- Emails from Amazon (Seller Central, Developer Central, Amazon Ads).
- macOS security alerts (built-in malware protection, firewall).

Check the Security log **at least weekly**, and whenever the red banner appears.

## 5. Response steps

Start within **1 hour** of noticing a possible incident.

1. **Record it.** Open an entry in the incident record (section 9): time noticed, what was seen, and the Security log entries.
2. **Contain.**
   - In SellerDoos Settings, click **Disconnect** on Seller Central and Amazon Ads.
   - In Seller Central, go to **Apps & Services → Manage Your Apps**, find SellerDoos and **remove its authorization**. This revokes every refresh token.
   - In the Solution Provider Portal (Developer Central), **rotate the LWA client secret** for the app.
   - For Amazon Ads, remove SellerDoos's access in your Amazon account's **Login with Amazon** settings, and rotate the security profile's client secret.
   - If the computer may be compromised, disconnect it from the network, run a full malware scan, and change your Amazon and email passwords from a different, clean device.
   - If the encryption key file (`~/.sellerdoos/master.key`) may be exposed, delete it and `data/sellerdoos.db`. SellerDoos creates a new key, and you reconnect.
3. **Assess.** Work out what data and which credentials were affected, for which time period, and how it happened.
4. **Report to Amazon within 24 hours of detection.** Email **security@amazon.com** with:
   - organization name and seller ID;
   - developer app name (SellerDoos) and App ID;
   - what happened, when it was detected, and which data or credentials were affected;
   - containment actions taken, and contact details.

   Follow any further instructions from Amazon. Notify anyone else as required by law.
5. **Recover.** Reconnect with new credentials only after the cause is fixed. Check that the Security log stays clean for a week.
6. **Close.** Write down the root cause and the changes made to prevent it happening again. Then click **I've reviewed these** in the Security log.

## 6. Security controls in place

- **Network:**
  - The macOS firewall is on, and the router firewall is on.
  - SellerDoos isn't exposed to the internet: it runs only on `localhost`.
  - Built-in macOS malware protection (XProtect) is enabled, and macOS is kept up to date.
- **Access control:** only the plan owner uses the computer account and SellerDoos. There are no shared accounts.
- **Encryption in transit:** all calls to Amazon use HTTPS (TLS).
- **Encryption at rest:**
  - FileVault full-disk encryption is on.
  - SellerDoos also encrypts saved keys and tokens with AES-256-GCM, using a separate key file readable only by the plan owner's user account.
- **Data minimization:** no buyer PII is requested or stored. Order data is kept without customer names or addresses.
- **No sharing:** Amazon Information isn't shared with third parties. DataForSEO receives only our own keywords and public ASIN.

## 7. Data retention

Amazon Information is kept only while it's useful for our analysis. Delete `data/sellerdoos.db` when SellerDoos is no longer used, and remove the app's authorization in Seller Central.

## 8. Plan review

Review this plan **every 6 months**, and after any incident. Check that it still matches how SellerDoos is used, that every contact detail is current, and that the controls in section 6 are still in place.

| Review date | Reviewed by | Changes |
| --- | --- | --- |
| [date] | [name] | Plan created |
| | | |

## 9. Incident record

| Detected (date and time) | Description | Data or credentials affected | Reported to Amazon (date and time) | Actions taken | Closed |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
