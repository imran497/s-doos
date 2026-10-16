import { getCredential } from "./credentials";
import { db } from "./db";

// Your seller (merchant) id. It comes with the Connect flow, or from Amazon's finance data when the
// connection was made by pasting a token. Not secret: it's shown in Seller Central's account info.

export function ownSellerId(): string | null {
  return (
    getCredential("SPAPI_SELLER_ID") ||
    (db.prepare("SELECT value FROM settings WHERE key = 'spapi:sellerId'").get() as { value: string } | undefined)?.value ||
    null
  );
}

export function rememberSellerId(id: string) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('spapi:sellerId', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(id);
}
