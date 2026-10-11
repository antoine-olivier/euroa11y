// The bundled catalog matches the installed axe-core: otherwise the report would drop the rules of a newer axe,
// or describe them with old texts. After an axe-core upgrade: npm run catalog.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { AXE_CATALOG_VERSION, axeRule, axeRuleIds } from "../src/axe-catalog.ts";

interface AxeRule {
  ruleId: string;
  help: string;
  helpUrl: string;
  tags: string[];
}

const require = createRequire(import.meta.url);
const axe = require("axe-core") as { getRules(): AxeRule[] };
const { version } = require("axe-core/package.json") as { version: string };

test("is the catalog of the installed axe-core", () => {
  assert.equal(AXE_CATALOG_VERSION, version, "run npm run catalog");
  const rules = axe.getRules();
  assert.deepEqual(axeRuleIds().sort(), rules.map((rule) => rule.ruleId).sort());
  for (const rule of rules) {
    const info = axeRule(rule.ruleId);
    assert.equal(info?.help, rule.help, rule.ruleId);
    assert.equal(info?.helpUrl, rule.helpUrl.replace(/\?.*$/, ""), rule.ruleId);
    assert.ok(info?.tags.every((tag) => rule.tags.includes(tag)), `${rule.ruleId}: a tag axe does not give`);
    // The tags the report reads: WCAG criteria and levels, and best practices.
    for (const tag of rule.tags.filter((tag) => /^wcag\d+a*$/.test(tag) || tag === "best-practice")) assert.ok(info?.tags.includes(tag), `${rule.ruleId}: ${tag} missing`);
  }
});

test("knows rule ids only", () => {
  assert.equal(axeRule("made-up"), undefined);
  assert.equal(axeRule("__proto__"), undefined);
  assert.equal(axeRule(42), undefined);
  assert.equal(axeRule("image-alt")?.helpUrl, `https://dequeuniversity.com/rules/axe/${version.split(".").slice(0, 2).join(".")}/image-alt`);
});
