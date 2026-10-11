// Scanner of the Workers build around its browser (audit A1-18): the slot is given back once, under the
// request's `waitUntil`, the browser is closed, and a client leaving closes it at once. Browser Run is
// replaced by a fake browser that never opens a page.
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { RawScan, ScanRequest } from "../src/scan-core.ts";

interface FakeBrowser {
  closed: number;
  version(): string;
  newContext(): Promise<never>;
  close(): Promise<void>;
}

let launches = 0;
let nextBrowser: () => FakeBrowser;

/** A browser whose page never opens: `newContext` fails at once, or waits until the browser is closed. */
function fakeBrowser(newContext: "fails" | "hangs"): FakeBrowser {
  let onClose = () => {};
  const browser: FakeBrowser = {
    closed: 0,
    version: () => "1.0",
    newContext: () =>
      newContext === "fails" ? Promise.reject(new Error("no page")) : new Promise<never>((_, reject) => (onClose = () => reject(new Error("Target closed")))),
    close: async () => {
      browser.closed += 1;
      onClose();
    },
  };
  return browser;
}

mock.module("@cloudflare/playwright", {
  exports: {
    launch: async () => {
      launches += 1;
      return nextBrowser();
    },
  },
});
const { createCloudflareScanner } = await import("../src/worker/scanner-cf.ts");

const REQUEST: ScanRequest = { url: new URL("https://example.com/"), bestPractices: false, viewport: { width: 1280, height: 800 }, fresh: false };

function setup(options: { cached?: RawScan; refuse?: boolean } = {}) {
  const given: number[] = [];
  const work: Promise<unknown>[] = [];
  const abort = new AbortController();
  const scanner = createCloudflareScanner({} as never, {
    checkHost: async () => null,
    axe: { source: "", version: "0" },
    admit: async () => {
      if (options.refuse) throw new Error("refused");
      return async (billedMs) => void given.push(billedMs);
    },
    cache: { get: async () => options.cached, put: async () => {} } as never,
    scope: () => ({ waitUntil: (promise) => void work.push(promise), signal: abort.signal }),
  });
  return { scanner, given, work, abort };
}

test("gives the slot back once, under waitUntil, and closes the browser when the scan fails", async () => {
  const browser = fakeBrowser("fails");
  nextBrowser = () => browser;
  const { scanner, given, work } = setup();
  await assert.rejects(scanner.scan(REQUEST), /no page/);
  assert.equal(work.length, 1, "the scan is handed to waitUntil");
  await Promise.all(work);
  assert.equal(given.length, 1);
  assert.equal(browser.closed, 1);
});

test("closes the browser at once when the client leaves", async () => {
  const browser = fakeBrowser("hangs");
  nextBrowser = () => browser;
  const { scanner, given, abort } = setup();
  const scanning = scanner.scan(REQUEST);
  // Lets the launch settle and the scan wait on its page.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const started = Date.now();
  abort.abort();
  await assert.rejects(scanning);
  assert.ok(Date.now() - started < 1_000, "ended by the close, not by the scan deadline");
  assert.equal(browser.closed, 1, "closed once, not again by the scan's own close");
  assert.equal(given.length, 1);
});

test("a cached result or a refused admission starts no browser", async () => {
  const before = launches;
  const cached = { url: "https://example.com/" } as unknown as RawScan;
  assert.equal(await setup({ cached }).scanner.scan(REQUEST), cached);
  const refused = setup({ refuse: true });
  await assert.rejects(refused.scanner.scan(REQUEST), /refused/);
  assert.equal(launches, before);
});
