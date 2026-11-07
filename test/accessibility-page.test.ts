// /accessibility: a statement of what was tested, never a claim of conformance; linked from the footer of every page.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCESSIBILITY_TESTED, accessibilityPage, docsPage, eaaCheckerPage, homePage, notFoundPage, privacyPage, termsPage } from "../src/pages.ts";

test("the accessibility page is served with one H1, its own canonical address and the page's security headers", async () => {
  const response = accessibilityPage();
  assert.equal(response.status, 200);
  assert.ok(response.headers.get("content-security-policy")?.includes("default-src 'none'"));
  const html = await response.text();
  assert.equal(html.match(/<h1[ >]/g)?.length, 1);
  assert.ok(html.includes("<title>Accessibility | EuroA11y</title>"));
  assert.ok(html.includes('<link rel="canonical" href="https://euroa11y.com/accessibility">'));
  assert.ok(html.includes('href="/accessibility" aria-current="page"'));
});

test("the accessibility page claims no conformance, says what was not tested and gives a way to report a problem", async () => {
  const html = await accessibilityPage().text();
  const text = html.replace(/<[^>]+>/g, " ");
  assert.ok(text.includes("makes no claim of conformance"));
  assert.ok(text.includes("What was not tested"));
  assert.ok(html.includes('href="mailto:contact@euroa11y.com"'));
  // No sentence states conformance, accessibility or compliance as a fact.
  for (const forbidden of [/\bis (fully |wcag[^.]*)?(conformant|compliant|accessible)\b/i, /\bconforms\b/i, /\bfully accessible\b/i, /\baccessibility statement\b/i]) assert.ok(!forbidden.test(text), String(forbidden));
});

test("the dates on the accessibility page are the test day, in the date format of the pages", async () => {
  assert.equal(ACCESSIBILITY_TESTED, "2026-11-07");
  const html = await accessibilityPage().text();
  assert.ok(html.includes("Last tested: 7 November 2026"));
  assert.ok(html.includes("5 November 2026"));
});

test("the footer of every page links the accessibility page", async () => {
  for (const response of [homePage("https://euroa11y.com/mcp"), docsPage("https://euroa11y.com/mcp"), privacyPage("2026-11-07"), termsPage("2026-11-07"), notFoundPage(), eaaCheckerPage(), accessibilityPage()]) {
    const footer = (await response.text()).match(/<nav aria-label="Footer">(.*?)<\/nav>/)?.[1] ?? "";
    assert.ok(/<a href="\/accessibility"[^>]*>Accessibility<\/a>/.test(footer), footer);
  }
});
