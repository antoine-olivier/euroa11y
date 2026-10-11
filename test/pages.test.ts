// Public pages: the inline copy script stays allowed by the CSP, every page loads the self-hosted fonts, and the
// links and copy buttons of the home page reach an element of the page.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { COPY_SCRIPT, COPY_SCRIPT_HASH, FONT_PATH, MONO_FONT_PATH, docsPage, homePage, notFoundPage, privacyPage, termsPage } from "../src/pages.ts";

test("the CSP hash matches the copy script", () => {
  assert.equal(COPY_SCRIPT_HASH, `sha256-${createHash("sha256").update(COPY_SCRIPT, "utf8").digest("base64")}`);
});

test("every page carries the script its CSP allows", async () => {
  for (const response of [homePage("https://euroa11y.com/mcp"), docsPage("https://euroa11y.com/mcp"), notFoundPage()]) {
    assert.ok(response.headers.get("content-security-policy")?.includes(`'${COPY_SCRIPT_HASH}'`));
    assert.ok((await response.text()).includes(`<script>${COPY_SCRIPT}</script>`));
  }
});

test("every page allows and preloads the self-hosted fonts, restricts powerful APIs but the clipboard, and marks the current link", async () => {
  const pages: [Response, string][] = [[homePage("https://euroa11y.com/mcp"), "/"], [docsPage("https://euroa11y.com/mcp"), "/docs"], [privacyPage("2026-10-04"), "/privacy"], [termsPage("2026-10-04"), "/terms"]];
  for (const [response, path] of pages) {
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get("content-security-policy")?.includes("font-src 'self'"), path);
    const permissions = response.headers.get("permissions-policy") ?? "";
    assert.ok(permissions.includes("camera=()") && !permissions.includes("clipboard-write"), path);
    const html = await response.text();
    assert.ok(html.includes(`href="${FONT_PATH}" as="font"`), path);
    assert.ok(html.includes(`href="${MONO_FONT_PATH}" as="font"`), path);
    assert.ok(html.includes(`href="${path}" aria-current="page"`), path);
  }
});

test("the home page ring links each failed criterion to its row, and its legend adds up to 55", async () => {
  const html = await homePage("https://euroa11y.com/mcp").text();
  const targets = [...html.matchAll(/<a href="#(sc-[\d-]+)" aria-label="[^"]+"><path class="s fail"/g)].map((match) => match[1]);
  assert.deepEqual(targets, ["sc-1-1-1", "sc-1-4-1", "sc-1-4-3", "sc-2-4-4", "sc-2-5-8", "sc-3-1-1", "sc-4-1-2"]);
  for (const id of targets) assert.ok(html.includes(`<tr id="${id}">`), id);
  const cells = (kind: string) => html.split(`class="s ${kind}"`).length - 1;
  assert.equal(cells("fail") + cells("auto") + cells("manual"), 55);
  const legend = [...html.matchAll(/<li><i class="(fail|auto|manual)"><\/i>[^<]*: (\d+)<\/li>/g)].map((match) => [match[1], Number(match[2])]);
  assert.deepEqual(legend, [["fail", cells("fail")], ["auto", cells("auto")], ["manual", cells("manual")]]);
});

// The script swaps the button's text for "Copied" and back: a child element would come back as plain text.
test("each copy button names an element of its page and holds plain text", async () => {
  for (const response of [homePage("https://euroa11y.com/mcp"), docsPage("https://euroa11y.com/mcp")]) {
    const html = await response.text();
    const buttons = [...html.matchAll(/<button type="button" data-copy="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)];
    assert.ok(buttons.length > 0);
    for (const [, id, label] of buttons) {
      assert.ok(html.includes(` id="${id}"`), id);
      assert.equal(label, "Copy", id);
    }
  }
});

test("an unknown address gets an HTML page with status 404, not cached", async () => {
  const response = notFoundPage();
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const html = await response.text();
  assert.ok(html.includes('<a href="/docs">Documentation</a>'));
  assert.ok(!html.includes('aria-current="page"'));
});
