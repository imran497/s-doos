// Amazon marketplaces SellerDoos can track. `region` picks the API endpoints; `sellerCentral` is where
// sellers authorize SellerDoos.
export const marketplaces = {
  US: { name: "United States", flag: "🇺🇸", domain: "amazon.com", id: "ATVPDKIKX0DER", region: "na", currency: "USD", sellerCentral: "https://sellercentral.amazon.com" },
  CA: { name: "Canada", flag: "🇨🇦", domain: "amazon.ca", id: "A2EUQ1WTGCTBG2", region: "na", currency: "CAD", sellerCentral: "https://sellercentral.amazon.ca" },
  MX: { name: "Mexico", flag: "🇲🇽", domain: "amazon.com.mx", id: "A1AM78C64UM0Y8", region: "na", currency: "MXN", sellerCentral: "https://sellercentral.amazon.com.mx" },
  UK: { name: "United Kingdom", flag: "🇬🇧", domain: "amazon.co.uk", id: "A1F83G8C2ARO7P", region: "eu", currency: "GBP", sellerCentral: "https://sellercentral.amazon.co.uk" },
  DE: { name: "Germany", flag: "🇩🇪", domain: "amazon.de", id: "A1PA6795UKMFR9", region: "eu", currency: "EUR", sellerCentral: "https://sellercentral.amazon.de" },
  FR: { name: "France", flag: "🇫🇷", domain: "amazon.fr", id: "A13V1IB3VIYZZH", region: "eu", currency: "EUR", sellerCentral: "https://sellercentral.amazon.fr" },
  IT: { name: "Italy", flag: "🇮🇹", domain: "amazon.it", id: "APJ6JRA9NG5V4", region: "eu", currency: "EUR", sellerCentral: "https://sellercentral.amazon.it" },
  ES: { name: "Spain", flag: "🇪🇸", domain: "amazon.es", id: "A1RKKUPIHCS9HS", region: "eu", currency: "EUR", sellerCentral: "https://sellercentral.amazon.es" },
  IN: { name: "India", flag: "🇮🇳", domain: "amazon.in", id: "A21TJRUUN4KGV", region: "eu", currency: "INR", sellerCentral: "https://sellercentral.amazon.in" },
  AE: { name: "UAE", flag: "🇦🇪", domain: "amazon.ae", id: "A2VIGQ35RCS4UG", region: "eu", currency: "AED", sellerCentral: "https://sellercentral.amazon.ae" },
  JP: { name: "Japan", flag: "🇯🇵", domain: "amazon.co.jp", id: "A1VC38T7YXB528", region: "fe", currency: "JPY", sellerCentral: "https://sellercentral.amazon.co.jp" },
  AU: { name: "Australia", flag: "🇦🇺", domain: "amazon.com.au", id: "A39IBJ37TRP1C6", region: "fe", currency: "AUD", sellerCentral: "https://sellercentral.amazon.com.au" },
} as const;

export type MarketplaceCode = keyof typeof marketplaces;

export const isMarketplace = (code: string): code is MarketplaceCode => code in marketplaces;

export const isAsin = (value: string) => /^[A-Z0-9]{10}$/.test(value);
