// axe results as the scanner keeps them: known rules only, a few elements each with their counts, and the
// passed rules as ids. axe runs inside the scanned page, whose scripts can rewrite what it returns, so every
// field is checked and bounded here before the report, the cache or the model sees it (security review,
// 2026-10-04 and 2026-10-05). No Node import here: shared by the Node and Workers builds.
import { axeRule } from "./axe-catalog.ts";

export const IMPACTS = ["critical", "serious", "moderate", "minor"] as const;
export type Impact = (typeof IMPACTS)[number];

/** Elements kept per rule: the most a report shows (`max_examples` is at most 5). */
export const MAX_NODES_PER_RULE = 5;
// axe 4.13 has 105 rules: more entries than that can only come from a forged result.
const MAX_RULE_ENTRIES = 200;

export interface ScannedNode {
  selector: string;
  html: string;
  fix: string;
  impact: Impact | null;
}

export interface ScannedRule {
  id: string;
  impact: Impact | null;
  /** Elements the rule reported, all of them, not only the ones kept in `nodes`. */
  elements: number;
  elementsByImpact: Partial<Record<Impact, number>>;
  nodes: ScannedNode[];
}

export interface ScanResults {
  violations: ScannedRule[];
  incomplete: ScannedRule[];
  /** Ids of the rules that passed. */
  passes: string[];
}

export function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Like `clip`, but keeps the end: the last part of a CSS selector names the element itself. */
export function clipStart(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `…${flat.slice(flat.length - max + 1)}` : flat;
}

/** Like `clip`, but cuts after the last whole sentence that fits, or at a word, never inside one. */
export function clipText(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max - 1);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf(": "), head.lastIndexOf("; "));
  if (sentence > max / 2) return `${head.slice(0, sentence + 1)} …`;
  const word = head.lastIndexOf(" ");
  return `${word > 0 ? head.slice(0, word) : head}…`;
}

function asImpact(value: unknown): Impact | null {
  return IMPACTS.find((impact) => impact === value) ?? null;
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 1_000_000) : 0;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Targets inside shadow roots are arrays of selectors, one per shadow boundary. */
function selectorOf(target: unknown): string {
  const parts = Array.isArray(target) ? target.slice(0, 10) : [];
  const joined = parts.map((part) => (Array.isArray(part) ? part.slice(0, 10).map(text).join(" >>> ") : text(part))).join(" | ");
  return clipStart(joined.replace(/`/g, "'"), 160);
}

/** axe's failure summary, "Fix any of the following:" then one check per line, as one line of text. */
function fixOf(summary: string): string {
  return summary
    .slice(0, 4000)
    .split(/\n(?=Fix )/)
    .map((block) => {
      const [heading = "", ...checks] = block.split("\n").map((line) => line.trim()).filter(Boolean);
      return checks.length ? `${heading} ${checks.join("; ")}.` : heading;
    })
    .join(" ");
}

function reduceNode(value: unknown): ScannedNode {
  const node = record(value);
  return { selector: selectorOf(node.target), html: clip(text(node.html).slice(0, 4000), 200), fix: clipText(fixOf(text(node.failureSummary)), 300), impact: asImpact(node.impact) };
}

function reduceRules(value: unknown): ScannedRule[] {
  const seen = new Set<string>();
  const rules: ScannedRule[] = [];
  for (const entry of Array.isArray(value) ? value.slice(0, MAX_RULE_ENTRIES) : []) {
    const rule = record(entry);
    const id = rule.id;
    if (typeof id !== "string" || !axeRule(id) || seen.has(id)) continue;
    seen.add(id);
    const nodes = (Array.isArray(rule.nodes) ? rule.nodes.slice(0, MAX_NODES_PER_RULE) : []).map(reduceNode);
    const counts = record(rule.elementsByImpact);
    const elementsByImpact: Partial<Record<Impact, number>> = {};
    let counted = 0;
    for (const impact of IMPACTS) {
      const count = asCount(counts[impact]);
      if (count) elementsByImpact[impact] = count;
      counted += count;
    }
    const impact = asImpact(rule.impact);
    // The page counts each element under one impact, so the counts add up to `elements`. Counts that do not
    // are completed under the rule's impact, as the page does for an element without one, so that the
    // report's total and its breakdown always agree.
    const elements = Math.max(asCount(rule.elements), nodes.length, counted);
    if (elements > counted) {
      const rest = impact ?? "minor";
      elementsByImpact[rest] = (elementsByImpact[rest] ?? 0) + elements - counted;
    }
    rules.push({ id, impact, elements, elementsByImpact, nodes });
  }
  return rules;
}

/** What the page sent back, reduced to known rules and bounded strings; anything malformed is dropped. */
export function reduceResults(value: unknown): ScanResults {
  const raw = record(value);
  const passes = [...new Set((Array.isArray(raw.passes) ? raw.passes.slice(0, MAX_RULE_ENTRIES) : []).filter((id): id is string => typeof id === "string" && axeRule(id) !== undefined))];
  return { violations: reduceRules(raw.violations), incomplete: reduceRules(raw.incomplete), passes };
}
