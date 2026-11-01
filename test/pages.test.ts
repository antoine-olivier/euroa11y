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

// A5-14 (audit 2026-10-05): the button label comes back after 2.5 s, but the "Copy failed" message stays in the
// live region until the next click, so a screen reader user who missed it can still read it.
// The test runs COPY_SCRIPT against a stub DOM with a fake clock and records every write to the live region.
async function clickCopy(outcomes: boolean[], clicksAt: number[]): Promise<string[]> {
  const log: string[] = [];
  const timers: { at: number; run: () => void; done: boolean }[] = [];
  let now = 0;
  let clicked: (() => Promise<void>) | undefined;
  const status = { set textContent(value: string) { log.push(`${now}:${value}`); } };
  const button = { dataset: { copy: "c", say: "Copied." }, textContent: "Copy", hidden: false, addEventListener: (_: string, handler: () => Promise<void>) => { clicked = handler; } };
  let next = 0;
  const document = { getElementById: (id: string) => (id === "copy-status" ? status : { textContent: "x" }), querySelectorAll: () => [button] };
  const navigator = { clipboard: { writeText: async () => { if (!outcomes[next++]) throw new Error("denied"); } } };
  new Function("document", "navigator", "setTimeout", COPY_SCRIPT)(document, navigator, (run: () => void, ms: number) => timers.push({ at: now + ms, run, done: false }));
  for (let i = 0; i < clicksAt.length; i++) {
    now = clicksAt[i]!;
    await clicked!();
    const until = clicksAt[i + 1] ?? Infinity;
    for (const timer of timers.filter((t) => !t.done && t.at <= until).sort((a, b) => a.at - b.at)) {
      timer.done = true;
      now = timer.at;
      timer.run();
    }
  }
  return log;
}

test("the copy script keeps its failure message and clears only a success message", async () => {
  assert.deepEqual(await clickCopy([true], [0]), ["0:Copied.", "2500:"]);
  const failed = await clickCopy([false], [0]);
  assert.ok(failed.every((entry) => !entry.endsWith(":") || entry === "0:"), "a failure message is never cleared by a timer");
  assert.equal(failed.at(-1)?.endsWith("Copy failed. Select the text and copy it."), true);
});

test("the copy script keeps the failure message of a click that follows a success within 2.5 s", async () => {
  const log = await clickCopy([true, false], [0, 1000]);
  assert.ok(log.at(-1)?.endsWith("Copy failed. Select the text and copy it."), log.join(" | "));
});

test("the copy script empties the live region before each failure so a repeated failure is announced again", async () => {
  const log = await clickCopy([false, false], [0, 5000]);
  const failures = log.filter((entry) => entry.endsWith("Copy failed. Select the text and copy it."));
  assert.equal(failures.length, 2);
  assert.ok(log[log.indexOf(failures[1]!) - 1]?.endsWith(":"), log.join(" | "));
});

test("every page opens its own browsing context group", () => {
  for (const response of [homePage("https://euroa11y.com/mcp"), docsPage("https://euroa11y.com/mcp"), privacyPage("2026-10-04"), termsPage("2026-10-04"), notFoundPage()]) {
    assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  }
});

// A5-08 (QCM 2026-11-01): the H1 asks what the tool decides (scope), not whether the site is "ready".
test("the home page H1 asks about the scope of the EAA and promises no readiness", async () => {
  const html = await homePage("https://euroa11y.com/mcp").text();
  assert.equal(html.match(/<h1>([^<]*)<\/h1>/g)?.length, 1);
  assert.ok(html.includes("<h1>Does the European Accessibility Act apply to your business?</h1>"));
  assert.ok(!/<h1>[^<]*ready/i.test(html));
});
