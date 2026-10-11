// Turns the scanner's axe results into the plugin's report: rules grouped by WCAG success criterion, worst first,
// with a few examples per rule. Everything here enters the remote model's context, so sizes are capped. Rule
// texts, links and tags come from the bundled axe catalog; ids, counts and element excerpts come from the
// scanned page, already bounded by axe-results.ts, and are shown as quoted data.
import { axeRule, type AxeRuleInfo } from "./axe-catalog.ts";
import { clip, IMPACTS, MAX_NODES_PER_RULE, type Impact, type ScannedRule } from "./axe-results.ts";
import { EAA_REMINDER, type EaaReminder } from "./eaa.ts";
import { rgaaForRule, type RgaaIndex } from "./rgaa-index.ts";
import type { RawScan } from "./scan-core.ts";
import { compareCriteria, criteriaFromTags, describeCriterion, NEW_IN_WCAG22, type Level } from "./wcag.ts";

export interface Example {
  selector: string;
  html: string;
  /** Only when it differs from the rule's `fix`. */
  fix?: string;
}

export interface RuleFinding {
  rule: string;
  impact: Impact | null;
  help: string;
  help_url: string;
  wcag: string[];
  /** RGAA 4.1.2 criteria related to the rule, with the RGAA option. */
  rgaa?: string[];
  elements: number;
  /** axe's summary of what to change on the first example. */
  fix: string;
  examples: Example[];
}

export interface CriterionGroup {
  sc: string;
  name: string;
  level: Level | null;
  rgaa?: Array<{ id: string; title: string }>;
  rules: RuleFinding[];
}

export interface ReviewItem {
  rule: string;
  help: string;
  wcag: string[];
  rgaa?: string[];
  elements: number;
  /** One element axe could not decide, and why. */
  example?: { selector: string; reason: string };
}

export interface ScanReport {
  url: string;
  final_url: string;
  http_status: number | null;
  title: string;
  scanned_at: string;
  /** Set when the result is reused from an earlier scan of the same page: until when (ISO date). */
  reused_until?: string;
  /** With `reused_until`: from when scan_page with `fresh` scans the page again (ISO date). */
  rescan_from?: string;
  engine: string;
  standard: string;
  summary: {
    failed_rules: number;
    failed_elements: number;
    elements_by_impact: Record<Impact, number>;
    passed_rules: number;
    needs_review_rules: number;
    /** Counted apart from the WCAG figures, when best practices were run. */
    best_practices?: { failed_rules: number; failed_elements: number };
  };
  criteria: CriterionGroup[];
  best_practices: RuleFinding[];
  needs_review: ReviewItem[];
  eaa: EaaReminder;
  limits: string[];
}

export interface ReportOptions {
  /** Examples per failed rule, 1 to 5; 2 by default. */
  maxExamples?: number;
  rgaa?: RgaaIndex;
}

const MAX_REVIEW_ITEMS = 10;

function rank(impact: Impact | null | undefined): number {
  return IMPACTS.indexOf(impact ?? "minor");
}

interface KnownRule {
  scanned: ScannedRule;
  info: AxeRuleInfo;
  wcag: string[];
  rgaa: Array<{ id: string; title: string }>;
}

/** Rules of the catalog only: a cached or hand-built result may hold others. */
function known(rules: readonly ScannedRule[], rgaa: RgaaIndex | undefined): KnownRule[] {
  return rules.flatMap((scanned) => {
    const info = axeRule(scanned.id);
    if (!info) return [];
    const wcag = criteriaFromTags(info.tags);
    return [{ scanned, info, wcag, rgaa: rgaa ? rgaaForRule(rgaa, scanned.id, info.tags, wcag) : [] }];
  });
}

function toFinding(rule: KnownRule, maxExamples: number, withRgaa: boolean): RuleFinding {
  const nodes = rule.scanned.nodes.slice(0, maxExamples);
  const fix = nodes[0]?.fix ?? "";
  return {
    rule: rule.scanned.id,
    impact: rule.scanned.impact,
    help: rule.info.help,
    help_url: rule.info.helpUrl,
    wcag: rule.wcag,
    ...(withRgaa ? { rgaa: rule.rgaa.map((criterion) => criterion.id) } : {}),
    elements: rule.scanned.elements,
    fix,
    // The same summary on every element of a rule is given once.
    examples: nodes.map((node) => ({ selector: node.selector, html: clip(node.html, 120), ...(node.fix && node.fix !== fix ? { fix: node.fix } : {}) })),
  };
}

function compareRgaa(a: { id: string }, b: { id: string }): number {
  const [a1 = 0, a2 = 0] = a.id.split(".").map(Number);
  const [b1 = 0, b2 = 0] = b.id.split(".").map(Number);
  return a1 - b1 || a2 - b2;
}

/** The checks axe could not settle, without the "Fix any of the following:" heading of its summary. */
function reasonOf(fix: string): string {
  return fix.replace(/Fix (?:any|all) of the following: /g, "").trim();
}

function exampleCount(asked: number | undefined): number {
  return typeof asked === "number" && Number.isFinite(asked) ? Math.min(Math.max(Math.floor(asked), 1), MAX_NODES_PER_RULE) : 2;
}

export function buildReport(scan: RawScan, options: ReportOptions = {}): ScanReport {
  const maxExamples = exampleCount(options.maxExamples);
  const withRgaa = options.rgaa !== undefined;
  const bestPracticesRun = scan.tags.includes("best-practice");
  const violations = known(scan.results.violations, options.rgaa).sort((a, b) => rank(a.scanned.impact) - rank(b.scanned.impact) || b.scanned.elements - a.scanned.elements);
  const incomplete = known(scan.results.incomplete, options.rgaa);

  const groups = new Map<string, CriterionGroup>();
  const groupRgaa = new Map<string, Map<string, { id: string; title: string }>>();
  const bestPractices: RuleFinding[] = [];
  const elementsByImpact: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  let failedRules = 0;
  let failedElements = 0;
  let bestPracticeElements = 0;
  for (const rule of violations) {
    const finding = toFinding(rule, maxExamples, withRgaa);
    // A rule tied to several criteria is listed once, under its first one; `wcag` keeps the full list.
    const primary = rule.wcag[0];
    if (!primary) {
      // A rule without a WCAG criterion is a best practice, reported only when best practices were run.
      if (bestPracticesRun) {
        bestPractices.push(finding);
        bestPracticeElements += rule.scanned.elements;
      }
      continue;
    }
    failedRules += 1;
    failedElements += rule.scanned.elements;
    for (const impact of IMPACTS) elementsByImpact[impact] += rule.scanned.elementsByImpact[impact] ?? 0;
    let group = groups.get(primary);
    if (!group) {
      group = { ...describeCriterion(primary), rules: [] };
      groups.set(primary, group);
      groupRgaa.set(primary, new Map());
    }
    group.rules.push(finding);
    for (const criterion of rule.rgaa) groupRgaa.get(primary)?.set(criterion.id, criterion);
  }
  if (withRgaa) for (const [sc, group] of groups) group.rgaa = [...(groupRgaa.get(sc)?.values() ?? [])].sort(compareRgaa);
  const criteria = [...groups.values()].sort((a, b) => rank(a.rules[0]?.impact) - rank(b.rules[0]?.impact) || compareCriteria(a.sc, b.sc));

  // A rule can pass on some elements and fail on others: it counts as failed only.
  const failedIds = new Set(violations.map((rule) => rule.scanned.id));
  const passed = scan.results.passes.filter((id) => !failedIds.has(id) && criteriaFromTags(axeRule(id)?.tags ?? []).length > 0).length;

  const limits = [
    "Automated checks only: axe-core finds on average 57% of WCAG issues (axe-core documentation). Keyboard use, screen-reader experience, content quality and many criteria need manual testing.",
    "This scan is not a conformance audit and cannot back an accessibility statement on its own.",
    `One page, viewport ${scan.viewport.width}×${scan.viewport.height}, main document only (iframe content is not analysed).`,
    "The page is scanned as a first-time visitor sees it: a cookie banner or consent dialog is left open and analysed with the page, and the content behind it may be hidden.",
  ];
  const both = incomplete.filter((rule) => failedIds.has(rule.scanned.id)).map((rule) => rule.scanned.id);
  if (both.length) limits.push(`Some rules are both failed and to review (${both.slice(0, 3).join(", ")}): axe could decide for some elements, not for others.`);
  if (scan.blockedRequests > 0) limits.push(`${scan.blockedRequests} request(s) were refused by the scanner (private address, non-web scheme or request cap); the page may have rendered incompletely.`);

  return {
    url: scan.requestedUrl,
    final_url: clip(scan.finalUrl, 500),
    http_status: scan.httpStatus,
    title: clip(scan.title, 160),
    scanned_at: scan.scannedAt,
    ...(scan.reusedUntil ? { reused_until: scan.reusedUntil, ...(scan.rescanFrom ? { rescan_from: scan.rescanFrom } : {}) } : {}),
    engine: `axe-core ${scan.axeVersion}`,
    standard: bestPracticesRun ? "WCAG 2.2 level AA + axe best practices" : "WCAG 2.2 level AA",
    summary: {
      failed_rules: failedRules,
      failed_elements: failedElements,
      elements_by_impact: elementsByImpact,
      passed_rules: passed,
      needs_review_rules: incomplete.length,
      ...(bestPracticesRun ? { best_practices: { failed_rules: bestPractices.length, failed_elements: bestPracticeElements } } : {}),
    },
    criteria,
    best_practices: bestPractices,
    needs_review: incomplete
      .sort((a, b) => b.scanned.elements - a.scanned.elements)
      .slice(0, MAX_REVIEW_ITEMS)
      .map((rule) => {
        const node = rule.scanned.nodes[0];
        const item: ReviewItem = { rule: rule.scanned.id, help: rule.info.help, wcag: rule.wcag, elements: rule.scanned.elements };
        if (withRgaa) item.rgaa = rule.rgaa.map((criterion) => criterion.id);
        if (node) item.example = { selector: node.selector, reason: reasonOf(node.fix) };
        return item;
      }),
    eaa: EAA_REMINDER,
    limits,
  };
}

/** Inline code span: text quoted from the scanned page, which survives backticks in it. */
function code(value: string): string {
  return `\`${value.replace(/`/g, "'") || " "}\``;
}

function ruleLines(rule: RuleFinding): string[] {
  const rgaa = rule.rgaa?.length ? ` [RGAA ${rule.rgaa.join(", ")}]` : "";
  const lines = [`- **${rule.rule}** [${rule.impact ?? "n/a"}] ${rule.help}: ${rule.elements} element(s)${rgaa}. ${rule.help_url}`];
  if (rule.fix) lines.push(`  How to fix (axe): ${code(rule.fix)}`);
  for (const example of rule.examples) lines.push(`  e.g. ${code(example.selector)} ${code(example.html)}${example.fix ? `, fix: ${code(example.fix)}` : ""}`);
  return lines;
}

function rgaaLine(group: CriterionGroup): string {
  if (group.rgaa?.length) return `RGAA 4.1.2: ${group.rgaa.map((criterion) => `${criterion.id} ${clip(criterion.title, 100)}`).join("; ")}`;
  return NEW_IN_WCAG22.has(group.sc) ? "RGAA 4.1.2: no related criterion (new in WCAG 2.2, while RGAA 4.1.2 follows WCAG 2.1)." : "RGAA 4.1.2: no known related criterion for these rules.";
}

/** Markdown for the model: summary, each criterion with its rules and examples, then the EAA rule and the limits. */
export function renderMarkdown(report: ScanReport): string {
  const s = report.summary;
  const impacts = s.elements_by_impact;
  const lines = ["# Accessibility scan", `Page: ${code(report.final_url)}${report.title ? `, title given by the page: ${code(report.title)}` : ""}`];
  if (report.url !== report.final_url) lines.push(`Requested: ${code(report.url)}, then redirected or changed by the page.`);
  // First, so that the model does not present an earlier state of the page as the current one.
  if (report.reused_until) {
    const from = report.rescan_from ? ` (accepted from ${report.rescan_from})` : "";
    lines.push(`Reused result: the page was scanned at ${report.scanned_at} and this result is kept until ${report.reused_until}, so changes made since then do not show. To check them, call scan_page again with fresh: true${from}.`);
  }
  lines.push(
    `${report.http_status !== null ? `HTTP ${report.http_status} · ` : ""}${report.standard} · ${report.engine} · scanned ${report.scanned_at}`,
    "",
    `WCAG failures: ${s.failed_rules} rule(s), ${s.failed_elements} element(s) (${impacts.critical} critical, ${impacts.serious} serious, ${impacts.moderate} moderate, ${impacts.minor} minor). WCAG rules passed: ${s.passed_rules}. Needs manual review: ${s.needs_review_rules} rule(s). These count axe rules, not WCAG criteria: they are not an accessibility score.`,
  );
  if (s.best_practices) lines.push(`Best practices, counted apart (not WCAG requirements): ${s.best_practices.failed_rules} rule(s), ${s.best_practices.failed_elements} element(s).`);
  for (const group of report.criteria) {
    lines.push("", `## ${group.sc} ${group.name}${group.level ? ` (${group.level})` : ""}`);
    if (group.rgaa) lines.push(rgaaLine(group));
    for (const rule of group.rules) lines.push(...ruleLines(rule));
  }
  if (report.best_practices.length) {
    lines.push("", "## Best practices (not WCAG requirements)");
    for (const rule of report.best_practices) lines.push(...ruleLines(rule));
  }
  if (report.needs_review.length) {
    lines.push("", "## Needs manual review");
    for (const rule of report.needs_review) {
      const refs = [rule.wcag.length ? `WCAG ${rule.wcag.join(", ")}` : "", rule.rgaa?.length ? `RGAA ${rule.rgaa.join(", ")}` : ""].filter(Boolean).join("; ");
      lines.push(`- **${rule.rule}** ${rule.help}: ${rule.elements} element(s)${refs ? ` [${refs}]` : ""}.`);
      if (rule.example) lines.push(`  e.g. ${code(rule.example.selector)}${rule.example.reason ? `: ${code(rule.example.reason)}` : ""}`);
    }
  }
  lines.push(
    "",
    "## European Accessibility Act (EAA)",
    ...report.eaa.rule.map((rule) => `- ${rule}`),
    report.eaa.next_step,
    `Sources: ${report.eaa.sources.map((source) => `${source.label}, ${source.url}`).join("; ")}.`,
  );
  lines.push("", "## Limits", ...report.limits.map((limit) => `- ${limit}`));
  return lines.join("\n");
}
