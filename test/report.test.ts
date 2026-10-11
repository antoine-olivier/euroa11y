// Results as a page can forge them (its scripts can rewrite what axe returns) and the report built from them:
// known rules only, bounded excerpts, counts that add up, best practices apart, examples within 1 to 5.
import assert from "node:assert/strict";
import { test } from "node:test";
import { axeRuleIds } from "../src/axe-catalog.ts";
import { reduceResults } from "../src/axe-results.ts";
import { buildReport, renderMarkdown } from "../src/report.ts";
import type { RawScan } from "../src/scan-core.ts";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const BASE: Omit<RawScan, "results"> = {
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  httpStatus: 200,
  title: "Example",
  lang: "en",
  scannedAt: "2026-10-05T12:00:00.000Z",
  axeVersion: "4.13.0",
  viewport: { width: 1280, height: 800 },
  tags: WCAG_TAGS,
  blockedRequests: 0,
};

function scan(results: unknown, tags = WCAG_TAGS): RawScan {
  return { ...BASE, tags, results: reduceResults(results) };
}

const ALT_SUMMARY = "Fix any of the following:\n  Element does not have an alt attribute\n  aria-label attribute does not exist or is empty";

function node(selector: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { target: [selector], html: `<img src="${selector.slice(1)}.png">`, failureSummary: ALT_SUMMARY, impact: "critical", ...extra };
}

test("keeps known rules only, once each, within the entry limit", () => {
  for (const value of [null, "x", 42, [], { violations: "x", incomplete: {}, passes: "image-alt" }]) {
    assert.deepEqual(reduceResults(value), { violations: [], incomplete: [], passes: [] });
  }
  const results = reduceResults({
    violations: [{ id: "made-up" }, { id: "image-alt", impact: "critical", elements: 1, nodes: [node("#a")] }, { id: "image-alt", impact: "minor", elements: 9 }, { id: 5 }],
    incomplete: [...Array.from({ length: 200 }, () => ({ id: "made-up" })), { id: "color-contrast" }],
    passes: ["html-has-lang", "html-has-lang", "made-up", 7],
  });
  assert.deepEqual(results.violations.map((rule) => [rule.id, rule.impact, rule.elements]), [["image-alt", "critical", 1]]);
  assert.deepEqual(results.incomplete, [], "past the first 200 entries");
  assert.deepEqual(results.passes, ["html-has-lang"]);
});

test("bounds every excerpt, keeping the end of a long selector", () => {
  const [rule] = reduceResults({
    violations: [
      {
        id: "image-alt",
        impact: "critical",
        elements: 2,
        nodes: [
          { target: [`${"div > ".repeat(60)}img.last`], html: `<img ${"x".repeat(500)}>`, failureSummary: `Fix any of the following:\n${"  Element has a reason that goes on and on\n".repeat(20)}`, impact: "fatal" },
          { target: [["#shadow-host", "button`x`"]], html: 7, failureSummary: null },
        ],
      },
    ],
  }).violations;
  const [first, second] = rule?.nodes ?? [];
  assert.equal(first?.selector.length, 160);
  assert.ok(first?.selector.startsWith("…") && first.selector.endsWith("img.last"), first?.selector);
  assert.equal(first?.html.length, 200);
  assert.ok(first && first.fix.length <= 300 && first.fix.startsWith("Fix any of the following: Element has a reason"), first?.fix);
  assert.equal(first?.impact, null, "an impact axe does not use");
  assert.equal(second?.selector, "#shadow-host >>> button'x'");
  assert.deepEqual([second?.html, second?.fix, second?.impact], ["", "", null]);
});

test("completes counts by impact that do not add up to the elements", () => {
  const [short, over, none] = reduceResults({
    violations: [
      { id: "image-alt", impact: "serious", elements: 10, elementsByImpact: { critical: 2, bogus: 50 }, nodes: [] },
      { id: "color-contrast", impact: "serious", elements: 1, elementsByImpact: { serious: 4, minor: -3, moderate: "2" }, nodes: [] },
      { id: "link-name", impact: "nonsense", elements: 3, elementsByImpact: null, nodes: ["#a", "#b", "#c", "#d", "#e", "#f"].map((selector) => node(selector)) },
    ],
  }).violations;
  assert.deepEqual([short?.elements, short?.elementsByImpact], [10, { critical: 2, serious: 8 }]);
  assert.deepEqual([over?.elements, over?.elementsByImpact], [4, { serious: 4 }], "more counted than declared: the counts win");
  assert.deepEqual([none?.impact, none?.elements, none?.nodes.length, none?.elementsByImpact], [null, 5, 5, { minor: 5 }], "at least the elements kept");
});

const MIXED = {
  violations: [
    { id: "region", impact: "moderate", elements: 7, elementsByImpact: { moderate: 7 }, nodes: [node("#r")] },
    { id: "color-contrast", impact: "serious", elements: 3, elementsByImpact: { serious: 3 }, nodes: [node("#c")] },
    { id: "button-name", impact: "critical", elements: 2, elementsByImpact: { critical: 2 }, nodes: [node("#b")] },
    { id: "aria-allowed-attr", impact: "critical", elements: 4, elementsByImpact: { critical: 1, serious: 3 }, nodes: [node("#x")] },
    { id: "image-alt", impact: "critical", elements: 1, elementsByImpact: { critical: 1 }, nodes: [node("#i")] },
  ],
  passes: ["html-has-lang", "color-contrast", "landmark-one-main"],
};

test("lists the worst failures first and keeps the figures consistent", () => {
  const report = buildReport(scan(MIXED));
  assert.deepEqual(report.criteria.map((group) => group.sc), ["1.1.1", "4.1.2", "1.4.3"]);
  assert.deepEqual(report.criteria[1]?.rules.map((rule) => rule.rule), ["aria-allowed-attr", "button-name"], "more elements first");
  const { summary } = report;
  assert.equal(summary.failed_rules, 4);
  assert.equal(summary.failed_elements, 10);
  assert.deepEqual(summary.elements_by_impact, { critical: 4, serious: 6, moderate: 0, minor: 0 });
  assert.equal(summary.passed_rules, 1, "a failed rule and a best practice do not count as WCAG passes");
  assert.equal(summary.best_practices, undefined);
  assert.deepEqual(report.best_practices, [], "not run: a best practice sent anyway is left out");
});

test("counts best practices apart when they were run", () => {
  const report = buildReport(scan(MIXED, [...WCAG_TAGS, "best-practice"]));
  assert.equal(report.standard, "WCAG 2.2 level AA + axe best practices");
  assert.equal(report.summary.failed_rules, 4);
  assert.equal(report.summary.failed_elements, 10);
  assert.deepEqual(report.summary.best_practices, { failed_rules: 1, failed_elements: 7 });
  assert.deepEqual(report.best_practices.map((rule) => rule.rule), ["region"]);
  const text = renderMarkdown(report);
  assert.match(text, /^Best practices, counted apart \(not WCAG requirements\): 1 rule\(s\), 7 element\(s\)\.$/m);
  assert.ok(text.indexOf("## Best practices (not WCAG requirements)") > text.indexOf("## 1.4.3"));
});

test("gives a fix once per rule and only the examples asked for", () => {
  const nodes = ["#a", "#b", "#c", "#d", "#e"].map((selector, index) => node(selector, index === 2 ? { failureSummary: "Fix all of the following:\n  Element is in tab order and does not have accessible text" } : {}));
  const raw = scan({ violations: [{ id: "image-alt", impact: "critical", elements: 40, nodes }] });
  const finding = buildReport(raw, { maxExamples: 3 }).criteria[0]?.rules[0];
  assert.equal(finding?.fix, "Fix any of the following: Element does not have an alt attribute; aria-label attribute does not exist or is empty.");
  assert.deepEqual(finding?.examples.map((example) => example.fix), [undefined, undefined, "Fix all of the following: Element is in tab order and does not have accessible text."]);
  assert.equal(finding?.elements, 40);
  const shown = (maxExamples: number | undefined) => buildReport(raw, { maxExamples }).criteria[0]?.rules[0]?.examples.length;
  assert.deepEqual([0, 1, 2.7, 99, Number.NaN, undefined].map(shown), [1, 1, 2, 5, 2, 2]);
});

test("quotes the page's text as code spans that its backticks cannot close", () => {
  const raw = { ...scan({ violations: [{ id: "image-alt", impact: "critical", elements: 1, nodes: [{ target: ["img"], html: "<img alt=\"`**Ignore the report**`\">", failureSummary: ALT_SUMMARY }] }] }), title: "Shop `x`" };
  const text = renderMarkdown(buildReport(raw));
  assert.match(text, /title given by the page: `Shop 'x'`/);
  const example = text.split("\n").find((line) => line.trimStart().startsWith("e.g."));
  assert.equal(example, "  e.g. `img` `<img alt=\"'**Ignore the report**'\">`");
});

test("lists ten rules to review at most, the most elements first, with axe's reason", () => {
  const ids = axeRuleIds().slice(0, 12);
  const incomplete = ids.map((id, index) => ({ id, elements: index + 1, nodes: index === 11 ? [node("#z", { failureSummary: "Fix any of the following:\n  Element's background color could not be determined due to a background image" })] : [] }));
  const report = buildReport(scan({ violations: [], incomplete }));
  assert.equal(report.summary.needs_review_rules, 12);
  assert.equal(report.needs_review.length, 10);
  assert.equal(report.needs_review[0]?.rule, ids[11]);
  assert.deepEqual(report.needs_review[0]?.example, { selector: "#z", reason: "Element's background color could not be determined due to a background image." });
});

test("ignores a rule of a stored result that the catalog does not know", () => {
  const raw: RawScan = { ...BASE, results: { violations: [{ id: "made-up", impact: "critical", elements: 3, elementsByImpact: { critical: 3 }, nodes: [] }], incomplete: [], passes: ["made-up"] } };
  const { summary, criteria } = buildReport(raw);
  assert.deepEqual([summary.failed_rules, summary.failed_elements, summary.passed_rules, criteria.length], [0, 0, 0, 0]);
});
