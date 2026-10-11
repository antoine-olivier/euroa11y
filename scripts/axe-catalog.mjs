// Freezes the rules of the installed axe-core into data/axe-rules.json: id, help text, help link and the tags
// the report reads (WCAG criteria and levels, categories, RGAA). Run after each axe-core upgrade:
// npm run catalog. The report takes these fields from the file, never from the scanned page, whose scripts
// can rewrite axe's results (security review, 2026-10-05).
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const axe = require("axe-core");
const { version } = require("axe-core/package.json");

// Section 508, Trusted Tester, EN 301 549 and ACT tags are not read by the report.
const KEPT_TAG = /^(wcag\d+a*|best-practice|experimental|deprecated|cat\.[a-z-]+|RGAA-\d+\.\d+\.\d+)$/;

const rules = [...axe.getRules()]
  .sort((a, b) => (a.ruleId < b.ruleId ? -1 : 1))
  .map((rule) => `    ${JSON.stringify(rule.ruleId)}: ${JSON.stringify({ help: rule.help, helpUrl: rule.helpUrl.replace(/\?.*$/, ""), tags: rule.tags.filter((tag) => KEPT_TAG.test(tag)) })}`);

const text = `{\n  "source": "axe-core getRules(), scripts/axe-catalog.mjs",\n  "version": ${JSON.stringify(version)},\n  "rules": {\n${rules.join(",\n")}\n  }\n}\n`;
writeFileSync(new URL("../data/axe-rules.json", import.meta.url), text);
console.log(`axe-core ${version}: ${rules.length} rules written to data/axe-rules.json`);
