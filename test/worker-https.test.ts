// HTTPS redirect and HSTS of the Worker, and the documentation page kept in step with the tools.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EAA_SECTORS } from "../src/eaa.ts";
import { docsPage } from "../src/pages.ts";
import { HSTS_HEADER, httpsRedirect, withHsts } from "../src/worker/https.ts";

test("redirects plain HTTP to HTTPS with 308, keeping path and query", () => {
  const response = httpsRedirect(new URL("http://euroa11y.com/mcp?x=1"));
  assert.equal(response?.status, 308);
  assert.equal(response?.headers.get("location"), "https://euroa11y.com/mcp?x=1");
  assert.equal(httpsRedirect(new URL("http://euroa11y.com:8080/docs"))?.headers.get("location"), "https://euroa11y.com/docs");
});

test("leaves HTTPS alone", () => {
  assert.equal(httpsRedirect(new URL("https://euroa11y.com/mcp")), undefined);
});

test("adds HSTS without touching status, headers or body", async () => {
  const response = withHsts(new Response("ok", { status: 202, headers: { "content-type": "text/plain" } }));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("content-type"), "text/plain");
  assert.equal(response.headers.get("strict-transport-security"), HSTS_HEADER);
  assert.equal(await response.text(), "ok");
});

test("documents both tools and every EAA sector", async () => {
  const html = await docsPage("https://euroa11y.com/mcp").text();
  for (const name of ["scan_page", "check_eaa_scope", "include_rgaa", "https://euroa11y.com/mcp", ...EAA_SECTORS]) assert.ok(html.includes(name), name);
});
