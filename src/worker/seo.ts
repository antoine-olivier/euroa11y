// Files for search engines and AI crawlers: robots.txt, sitemap.xml and llms.txt (llmstxt.org). Pure functions of
// the brand and the public paths, so the Worker only picks one by path. Every statement here is taken from the
// home page, /docs and docs/submission/2026-10-04-dossiers.md; no figure about audience or speed.
import { BRAND } from "../brand.ts";

/** Public pages the Worker serves with status 200, in sitemap order. Test: test/seo.test.ts renders each one. */
export const PUBLIC_PATHS = ["/", "/docs", "/privacy", "/terms"] as const;

const MCP_PATH = "/mcp";
const absolute = (path: string): string => `${BRAND.site}${path}`;

export function robotsTxt(mcpPath: string = MCP_PATH): string {
  return `User-agent: *\nDisallow: ${mcpPath}\n\nSitemap: ${absolute("/sitemap.xml")}\n`;
}

export function sitemapXml(): string {
  const urls = PUBLIC_PATHS.map((path) => `  <url><loc>${absolute(path)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Plain-text summary of the service for language models, in the llms.txt format (H1, quote, sections of links). */
export function llmsTxt(): string {
  const name = BRAND.name;
  return `# ${name}

> ${name} is a free remote MCP server for ChatGPT, Claude and other MCP clients. It has two read-only tools: an automated accessibility scan of one public web page (WCAG 2.2 level AA, with axe-core) and a check of whether the European Accessibility Act (EAA) applies to a business. No account, no authentication.

Connector URL (remote MCP server, Streamable HTTP, no authentication): ${absolute(MCP_PATH)}

The service is published by ${BRAND.publisher} (${BRAND.country}). It is independent and not affiliated with the European Union or any EU institution. Contact: ${BRAND.contactEmail}

## Tools

- scan_page: loads one public page in a headless Chromium browser, runs axe-core against WCAG 2.2 level AA and returns the failures grouped by WCAG success criterion, most severe first, with the failing elements and how to fix them. Parameters: url (required), viewport (desktop or mobile), include_rgaa (adds the related criteria of RGAA 4.1.2, the French framework), include_best_practices, max_examples (1 to 5), fresh (scan again instead of reusing a recent result). A scan usually takes 5 to 30 seconds.
- check_eaa_scope: applies the scope rules of Directive (EU) 2019/882, applicable since 28 June 2025, to the service, headcount and turnover given, including the exemption for microenterprises. It returns a verdict (in_scope, terminals_only, exempt_microenterprise, out_of_scope, public_sector_other_law or need_more_info) with its reasons and legal sources. No network access, nothing stored. Information, not legal advice.

## Add it to Claude

On claude.ai or the Claude desktop app. The Free plan allows one custom connector.

1. Open Customize, then Connectors (https://claude.ai/customize/connectors). Select + Add, then Add custom connector.
2. Name it ${name}, paste the connector URL and select Continue. Choose No sign in, select Continue, then Add.
3. In a conversation, open the + menu at the bottom left, then Connectors, and turn ${name} on.

Team or Enterprise plan: an owner first adds ${name} in Organization settings, then Connectors. Each member then finds it in Customize, then Connectors, and selects Connect.

## Add it to ChatGPT

On the web, with a Plus, Pro, Business, Enterprise or Education account. Availability can depend on your account and workspace policy.

1. Open Settings, then Security and login, and turn on Developer mode.
2. Open Plugins and select the + button. Enter ${name} as the name, a short description and the connector URL, with no authentication, then create it.
3. On the ${name} plugin page, select Connect and add it to ChatGPT. Without this step, ChatGPT answers without ${name}.
4. In a conversation, open the + menu, choose Developer mode and select ${name}.

If the assistant answers without ${name}, name it in the request.

## Limits

- Automated tools detect only part of accessibility issues. A scan with no failure does not mean the page is accessible or compliant; a conformance claim or an accessibility statement needs a manual audit.
- One public page per call, main document only (no iframe), no login, no form submission. Pages behind bot protection may refuse the scan.
- Fair-use limits keep the service free: for each ChatGPT account or network address, one scan at a time and 40 a day.
- The EAA check is a simplified reading of the directive, not legal advice.
- The raw result of a scan, which includes the page address, is kept up to 24 hours, encrypted, to answer the same request again. Logs hold no page address and no argument.

## Pages

- [Home](${absolute("/")}): what ${name} does and how to add it to Claude or ChatGPT
- [Documentation](${absolute("/docs")}): connection steps, parameters, verdicts and limits
- [Privacy policy](${absolute("/privacy")}): what the service receives, why and for how long
- [Terms of use](${absolute("/terms")}): a free, informational service
`;
}

/** End of validity of security.txt (RFC 9116 asks for a date under a year ahead): renew it before then, with the file's contents. */
export const SECURITY_TXT_EXPIRES = "2027-10-31T00:00:00.000Z";

/** RFC 9116 file: where to report a vulnerability of the service. Not a page: left out of the sitemap. */
export function securityTxt(): string {
  return `Contact: mailto:${BRAND.contactEmail}\nExpires: ${SECURITY_TXT_EXPIRES}\nPreferred-Languages: en, fr\nCanonical: ${absolute("/.well-known/security.txt")}\n`;
}

const FILES: Record<string, { body: () => string; type: string }> = {
  "/robots.txt": { body: () => robotsTxt(), type: "text/plain; charset=utf-8" },
  "/sitemap.xml": { body: sitemapXml, type: "application/xml; charset=utf-8" },
  "/llms.txt": { body: llmsTxt, type: "text/plain; charset=utf-8" },
  "/.well-known/security.txt": { body: securityTxt, type: "text/plain; charset=utf-8" },
};

/** The response for one of the three files, or undefined for any other path. Same headers as the HTML pages. */
export function seoFile(pathname: string): Response | undefined {
  const file = Object.hasOwn(FILES, pathname) ? FILES[pathname] : undefined;
  if (!file) return undefined;
  return new Response(file.body(), { headers: { "content-type": file.type, "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } });
}
