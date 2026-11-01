// Audit n° 29: /rgaa-wcag is built from data/rgaa-4.1.2-wcag.json and says "related", never "equivalent".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { COPY_SCRIPT, COPY_SCRIPT_HASH, docsPage, rgaaWcagPage, termsPage } from "../src/pages.ts";
import { RGAA_DATA_PATH } from "../src/rgaa.ts";
import type { RgaaData } from "../src/rgaa-index.ts";
import { CRITERIA, NEW_IN_WCAG22 } from "../src/wcag.ts";

const RGAA = JSON.parse(readFileSync(RGAA_DATA_PATH, "utf8")) as RgaaData;
const rowOf = (html: string, sc: string): string => html.split(`<tr id="sc-${sc.replaceAll(".", "-")}">`)[1]?.split("</tr>")[0] ?? "";

test("the /rgaa-wcag page answers 200 with the usual headers, one H1 and no new script source", async () => {
  const response = rgaaWcagPage(RGAA);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.ok(csp.includes(`script-src '${COPY_SCRIPT_HASH}'`));
  assert.ok(!/script-src[^;]*https?:/.test(csp));
  const html = await response.text();
  assert.equal(html.match(/<h1>/g)?.length, 1);
  assert.ok(html.includes('<link rel="canonical" href="https://euroa11y.com/rgaa-wcag">'));
  assert.ok(html.includes('href="/rgaa-wcag"') || html.includes('<link rel="canonical"'));
  assert.ok(html.includes(`<script>${COPY_SCRIPT}</script>`));
  assert.ok(!/<td><ul>/.test(html), "lists in cells carry role=list");
});

test("the /rgaa-wcag page lists every level A and AA criterion with its related RGAA criteria", async () => {
  const html = await rgaaWcagPage(RGAA).text();
  const expected = Object.entries(CRITERIA).filter(([sc, c]) => c.level !== "AAA" && sc !== "4.1.1").map(([sc]) => sc);
  const rows = [...html.matchAll(/<tr id="sc-([\d-]+)">/g)].map((match) => (match[1] ?? "").replaceAll("-", "."));
  assert.equal(rows.length, 55);
  assert.deepEqual([...rows].sort(), [...expected].sort());
  for (const criterion of RGAA.criteria) {
    for (const sc of criterion.wcag.filter((id) => expected.includes(id))) assert.ok(rowOf(html, sc).includes(`<span class="rid">${criterion.id}</span>`), `${sc} lists RGAA ${criterion.id}`);
  }
  for (const sc of NEW_IN_WCAG22) assert.ok(rowOf(html, sc).includes("new in WCAG 2.2"), sc);
});

test("the /rgaa-wcag page states related, not equivalent, and claims no legal equivalence or conformance", async () => {
  const html = await rgaaWcagPage(RGAA).text();
  assert.ok(html.includes("<strong>related</strong>, not <strong>equivalent</strong>"));
  assert.ok(html.includes("states no legal equivalence"));
  assert.ok(html.includes(RGAA.source) && html.includes("3 October 2026"));
  assert.ok(!/\b(is|are) equivalent\b|compliant with RGAA|guarantee/i.test(html));
});

test("the docs point to /rgaa-wcag and every page footer links to it", async () => {
  assert.ok((await docsPage("https://euroa11y.com/mcp").text()).includes('<a href="/rgaa-wcag">See the full table</a>'));
  assert.ok((await termsPage("2026-10-04").text()).includes('<a href="/rgaa-wcag">RGAA and WCAG</a>'));
});
