# EuroA11y

EuroA11y is a free remote MCP server for ChatGPT, Claude and other MCP clients. It has two read-only tools: an automated accessibility scan of one public web page (WCAG 2.2 level AA, with axe-core) and a check of whether the European Accessibility Act (EAA) applies to a business. No account, no authentication.

- Connector URL (Streamable HTTP, no authentication): `https://euroa11y.com/mcp`
- Website and setup steps for Claude and ChatGPT: [euroa11y.com](https://euroa11y.com/), [documentation](https://euroa11y.com/docs)
- Published by Antoine Olivier (France). Independent, not affiliated with the European Union or any EU institution.

## Tools

- **`scan_page`** loads one public page in a headless Chromium browser, runs axe-core against WCAG 2.2 level AA and returns the failures grouped by WCAG success criterion, most severe first, with the failing elements and how to fix them. Parameters: `url` (required), `viewport` (`desktop` or `mobile`), `include_rgaa` (adds the related criteria of RGAA 4.1.2, the French framework), `include_best_practices`, `max_examples` (1 to 5), `fresh` (scan again instead of reusing a recent result). A scan usually takes 5 to 30 seconds.
- **`check_eaa_scope`** applies the scope rules of Directive (EU) 2019/882, applicable since 28 June 2025, to the service, headcount and turnover given, including the exemption for microenterprises. It returns a verdict (`in_scope`, `terminals_only`, `exempt_microenterprise`, `out_of_scope`, `public_sector_other_law` or `need_more_info`) with its reasons and legal sources. No network access, nothing stored. Information, not legal advice.

Example prompts:

- Check the accessibility of https://www.gov.uk on mobile
- Which RGAA criteria does my home page fail? https://example.fr
- I run an online shop with 6 employees. Does the EAA apply to me?

## Limits

- Automated tools detect only part of accessibility issues. A scan with no failure does not mean the page is accessible or compliant; a conformance claim or an accessibility statement needs a manual audit.
- One public page per call, main document only (no iframe), no login, no form submission. Pages behind bot protection may refuse the scan.
- Fair-use limits keep the hosted service free: for each ChatGPT account or network address, one scan at a time and 40 a day.
- The raw result of a scan, which includes the page address, is kept up to 24 hours, encrypted, to answer the same request again. Logs hold no page address and no argument. Details: [privacy policy](https://euroa11y.com/privacy).

## Development

Requires Node.js (see `engines` in `package.json`).

```bash
npm ci
npm run check
node src/cli.ts https://www.gov.uk --rgaa
```

- `npm run check` runs the type checks and the tests. `git config core.hooksPath .githooks` runs it before each commit.
- `npm run mcp:http` starts the MCP server over HTTP on this machine, with Node.
- The hosted service is a Cloudflare Worker (`src/worker/`, `wrangler.jsonc`) that scans in Cloudflare Browser Run, which needs the Workers Paid plan. To deploy your own copy, change the route in `wrangler.jsonc` to your domain. `node scripts/smoke.mjs <base URL>` checks the Worker's routes without running a scan.

Safeguards in the code: private, local and reserved addresses are refused for the page and each redirect, the scan is bounded in time and requests, the daily browser time has a global budget, and only rules from the bundled axe-core catalogue are kept in a report, since the scanned page can tamper with axe's results.

## Data and credits

- [axe-core](https://github.com/dequelabs/axe-core) by Deque Systems (MPL-2.0) runs the WCAG checks.
- `data/rgaa-4.1.2-wcag.json` maps RGAA 4.1.2 criteria to WCAG references, from the source repository of accessibilite.numerique.gouv.fr (`RGAA/criteres.json` and the criteria annexes). RGAA 4.1.2 follows WCAG 2.1: criteria new in WCAG 2.2 have no RGAA equivalent.
- Fonts: Atkinson Hyperlegible Next and Mono (SIL Open Font License, files in `assets/fonts/`).

## License

MIT, see [LICENSE](LICENSE). Contact: contact@euroa11y.com
