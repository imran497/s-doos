import type { SerpProvider } from "./types";

// Made-up but stable ranks so the app can be tried before a real API key is added.
// Every row it writes is stored with source = 'demo' and can be cleared in Settings.
export const demoProvider: SerpProvider = {
  id: "demo",
  label: "Demo data",
  kind: "demo",
  isDemo: true,
  async search() {
    throw new Error("The demo provider does not fetch pages; use demoRanks().");
  },
};

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/** A keyword's demo organic and sponsored rank on a given day. */
export function demoRanks(asin: string, keyword: string, date: string) {
  const base = hash(`${asin}|${keyword}`);
  const dayIndex = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 86_400_000);
  const wobble = Math.sin(dayIndex / 3 + base * 10) * 0.25 + (hash(`${keyword}|${date}`) - 0.5) * 0.2;

  // Spread keywords from page-one winners to deep, unranked long-tail terms.
  const organicScore = Math.min(Math.max(base + wobble * base, 0), 1.2);
  const organic = organicScore > 0.95 ? null : Math.max(1, Math.round(organicScore ** 2.2 * 160));
  const sponsoredRoll = hash(`ad|${keyword}|${date}`);
  const sponsored = sponsoredRoll < 0.45 ? Math.max(1, Math.round(sponsoredRoll * 40)) : null;
  return { organic, sponsored };
}
