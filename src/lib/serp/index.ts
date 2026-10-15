import { getCredential } from "../credentials";
import { isDataForSeoConfigured } from "../dataforseo";
import { demoProvider } from "./demo";
import { rainforestProvider } from "./rainforest";
import type { SerpProvider } from "./types";

const dataForSeoProvider: SerpProvider = {
  id: "dataforseo",
  label: "DataForSEO",
  kind: "async",
  isDemo: false,
  async search() {
    throw new Error("DataForSEO searches are queued and collected by the tracker, not fetched page by page.");
  },
};

/** The configured search results source: DataForSEO, then Rainforest, then demo data. */
export function getSerpProvider(): SerpProvider {
  if (isDataForSeoConfigured()) return dataForSeoProvider;
  const key = getCredential("RAINFOREST_API_KEY");
  return key ? rainforestProvider(key) : demoProvider;
}

export type { SerpProvider } from "./types";
