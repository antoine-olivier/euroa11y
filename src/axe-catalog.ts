// Rules of the bundled axe-core, frozen in data/axe-rules.json by `npm run catalog`. axe runs inside the scanned
// page, whose scripts can rewrite its results: a rule id is kept only when known here, and its help text, link
// and tags come from this file, never from the page (security review, 2026-10-05).
import catalog from "../data/axe-rules.json" with { type: "json" };

export interface AxeRuleInfo {
  help: string;
  helpUrl: string;
  tags: readonly string[];
}

export const AXE_CATALOG_VERSION: string = catalog.version;

const RULES = new Map<string, AxeRuleInfo>(Object.entries(catalog.rules));

/** Catalog entry of a rule id received from the page; undefined for anything else. */
export function axeRule(id: unknown): AxeRuleInfo | undefined {
  return typeof id === "string" ? RULES.get(id) : undefined;
}

/** Every rule id of the catalog, for tests. */
export function axeRuleIds(): string[] {
  return [...RULES.keys()];
}
