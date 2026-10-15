// Misc charge categories and how Amazon transactions map onto them. No database access, so the page's
// client components can use it too.

export type ExpenseGroup = "amazon" | "advertising" | "own";
/** cost: counted in totals. in_shipment: already part of a shipment's cost. transfer: moves money, not a cost. */
export type Treatment = "cost" | "in_shipment" | "transfer";

export type CategoryInfo = { key: string; name: string; group: ExpenseGroup; treatment: Treatment; auto: boolean; hint?: string };

/** Amazon-side categories, filled in from SP-API (shown first), then advertising. */
export const AMAZON_CATEGORIES: CategoryInfo[] = [
  { key: "amazon_subscription", name: "Seller subscription", group: "amazon", treatment: "cost", auto: true },
  { key: "amazon_storage", name: "FBA storage fees", group: "amazon", treatment: "cost", auto: true, hint: "Monthly, long-term and aged inventory storage" },
  { key: "amazon_promotions", name: "Coupon & deal fees", group: "amazon", treatment: "cost", auto: true },
  { key: "amazon_vine", name: "Vine", group: "amazon", treatment: "cost", auto: true },
  { key: "amazon_removals", name: "Removals & disposals", group: "amazon", treatment: "cost", auto: true },
  { key: "amazon_other", name: "Other Amazon fees", group: "amazon", treatment: "cost", auto: true },
  { key: "amazon_reimbursement", name: "Reimbursements", group: "amazon", treatment: "cost", auto: true, hint: "Money Amazon paid you back (lost or damaged stock)" },
  {
    key: "amazon_inbound",
    name: "Inbound placement & transport",
    group: "amazon",
    treatment: "in_shipment",
    auto: true,
    hint: "Already counted as the placement fee on your shipments, so not added again",
  },
  {
    key: "amazon_debt",
    name: "Negative balance payments",
    group: "amazon",
    treatment: "transfer",
    auto: true,
    hint: "Your card covering fees your seller balance couldn't. The fees are already counted, so these aren't added again",
  },
  { key: "advertising", name: "Advertising", group: "advertising", treatment: "cost", auto: false, hint: "Billed to your card, so not in SP-API. Automatic once Amazon Ads is connected" },
];

export const GROUP_LABELS: Record<ExpenseGroup, string> = { amazon: "Amazon", advertising: "Advertising", own: "Your costs" };

/**
 * Category for an SP-API Finances transaction (2024-06-19 listTransactions), or null when it belongs to
 * order-level profit (sales, refunds, payouts) rather than misc charges.
 */
export function classifyAmazonTransaction(type: string, description: string): string | null {
  const t = type.toLowerCase();
  const d = description.toLowerCase();
  if (["shipment", "refund", "transfer", "guaranteeclaim", "chargeback", "retrocharge", "taxwithholding"].includes(t)) return null;
  if (t === "debtrecovery") return "amazon_debt";
  if (t.includes("reimbursement")) return "amazon_reimbursement";
  if (t === "productadspayment") return "advertising";
  if (t.includes("removal") || d.includes("removal") || d.includes("disposal")) return "amazon_removals";
  if (d.includes("subscription")) return "amazon_subscription";
  if (d.includes("storage")) return "amazon_storage";
  if (d.includes("coupon") || d.includes("deal") || t.includes("deal") || t.includes("coupon")) return "amazon_promotions";
  if (d.includes("vine")) return "amazon_vine";
  if (d.includes("inbound") || d.includes("placement")) return "amazon_inbound";
  return "amazon_other";
}

/** Readable name for Amazon's descriptions ("FBAStorageBilling" → "FBA storage billing"). */
export function amazonDescription(type: string, description: string) {
  const known: Record<string, string> = {
    Subscription: "Professional seller subscription",
    FBAStorageBilling: "Monthly storage fee",
    CouponParticipationEvent: "Coupon participation fee",
    CouponPerformanceEvent: "Coupon performance fee",
    FBAInboundConvenience: "Inbound placement service fee",
    FBAPostInboundTransportation: "Inbound transportation fee",
    VineCharge: "Vine enrollment fee",
    DebtPayment: "Card payment for negative balance",
    WAREHOUSE_DAMAGE: "Reimbursement: damaged in warehouse",
    WAREHOUSE_LOST: "Reimbursement: lost in warehouse",
  };
  if (known[description]) return known[description];
  const words = (description || type)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\bfba\b/g, "FBA");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
