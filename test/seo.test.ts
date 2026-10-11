// Search and AI discovery: robots.txt, sitemap.xml and llms.txt agree with the pages the site serves, and every
// page carries its title, description, canonical address and Open Graph tags. The home page adds JSON-LD.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BRAND } from "../src/brand.ts";
import { COPY_SCRIPT, docsPage, homePage, notFoundPage, privacyPage, termsPage } from "../src/pages.ts";
import { PUBLIC_PATHS, llmsTxt, robotsTxt, seoFile, sitemapXml } from "../src/worker/seo.ts";

const MCP = "https://euroa11y.com/mcp";
const render = (path: string): Response => {
  switch (path) {
    case "/":
      return homePage(MCP);
    case "/docs":
      return docsPage(MCP);
    case "/privacy":
      return privacyPage("2026-10-04");
    case "/terms":
      return termsPage("2026-10-04");
    default:
      throw new Error(path);
  }
};
const meta = (html: string, attribute: "name" | "property", key: string): string | undefined => html.match(new RegExp(`<meta ${attribute}="${key}" content="([^"]*)"`))?.[1];

test("robots.txt keeps the endpoint closed and names the sitemap", () => {
  assert.equal(robotsTxt(), "User-agent: *\nDisallow: /mcp\n\nSitemap: https://euroa11y.com/sitemap.xml\n");
});

test("the sitemap lists exactly the public pages, each served with status 200", async () => {
  const locs = [...sitemapXml().matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(locs, PUBLIC_PATHS.map((path) => `${BRAND.site}${path}`));
  for (const path of PUBLIC_PATHS) assert.equal(render(path).status, 200, path);
});

test("llms.txt follows the llmstxt.org shape and carries the connector URL, both tools and the limits", () => {
  const text = llmsTxt();
  const lines = text.split("\n");
  assert.ok(lines[0]?.startsWith("# EuroA11y"));
  assert.ok(lines.find((line) => line.length > 0 && !line.startsWith("#"))?.startsWith("> "));
  for (const needle of [MCP, "scan_page", "check_eaa_scope", "Developer mode", "Add custom connector", "does not mean the page is accessible or compliant"]) assert.ok(text.includes(needle), needle);
  for (const path of PUBLIC_PATHS) assert.ok(text.includes(`(${BRAND.site}${path})`), path);
});

test("the three files are served as text with a cache lifetime, and other paths are left alone", async () => {
  for (const [path, type] of [["/robots.txt", "text/plain"], ["/sitemap.xml", "application/xml"], ["/llms.txt", "text/plain"]] as const) {
    const response = seoFile(path);
    assert.ok(response, path);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get("content-type")?.startsWith(type), path);
    assert.equal(response.headers.get("cache-control"), "public, max-age=3600", path);
    assert.ok((await response.text()).length > 0, path);
  }
  assert.equal(seoFile("/"), undefined);
  assert.equal(seoFile("/constructor"), undefined);
});

test("each public page has its own title and description, a canonical address and Open Graph tags", async () => {
  const descriptions = new Set<string>();
  for (const path of PUBLIC_PATHS) {
    const html = await render(path).text();
    const canonical = `${BRAND.site}${path}`;
    const description = meta(html, "name", "description") ?? "";
    assert.ok(description.length >= 60 && description.length <= 160, `${path} description is ${description.length} characters`);
    descriptions.add(description);
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}">`), path);
    assert.equal(meta(html, "property", "og:url"), canonical, path);
    assert.equal(meta(html, "property", "og:description"), description, path);
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
    assert.ok(title.length > 0 && title.length <= 65, `${path} title is ${title.length} characters`);
    assert.equal(meta(html, "property", "og:title"), title, path);
    assert.equal(meta(html, "property", "og:image"), `${BRAND.site}/icon-512.png`, path);
    assert.equal(meta(html, "property", "og:type"), "website", path);
    assert.ok(!html.includes('content="noindex"'), path);
  }
  assert.equal(descriptions.size, PUBLIC_PATHS.length, "descriptions differ from page to page");
});

test("the not-found page asks not to be indexed and names no canonical address", async () => {
  const html = await notFoundPage().text();
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
  assert.ok(!html.includes('rel="canonical"'));
});

test("the home page carries a free WebApplication in JSON-LD, with no rating or review", async () => {
  const html = await homePage(MCP).text();
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((match) => JSON.parse(match[1] ?? "") as Record<string, unknown>);
  assert.equal(blocks.length, 1);
  const [data] = blocks;
  assert.equal(data?.["@type"], "WebApplication");
  assert.equal(data?.url, `${BRAND.site}/`);
  assert.equal(data?.name, BRAND.name);
  assert.deepEqual(data?.offers, { "@type": "Offer", price: "0", priceCurrency: "EUR" });
  for (const forbidden of ["aggregateRating", "review", "ratingValue"]) assert.ok(!(forbidden in (data ?? {})), forbidden);
  for (const path of ["/docs", "/privacy", "/terms"]) assert.ok(!(await render(path).text()).includes("application/ld+json"), path);
});

// The CSP allows one script by hash; a JSON-LD block is data, not a script, so the only executable script stays the copy script.
test("the only executable script of each page is the copy script", async () => {
  for (const path of PUBLIC_PATHS) {
    const html = await render(path).text();
    const executable = [...html.matchAll(/<script(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.deepEqual(executable, [COPY_SCRIPT], path);
  }
});
