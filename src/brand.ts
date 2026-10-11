// Product identity in one place (name chosen 2026-10-04): every page, server instruction and user agent
// reads it from here.
export const BRAND = {
  name: "EuroA11y",
  /** MCP server name and user-agent product token. */
  slug: "euroa11y",
  version: "0.2.0",
  /** Public site, also the origin of the MCP endpoint and of the icons it declares. */
  site: "https://euroa11y.com",
  publisher: "Antoine Olivier",
  country: "France",
  /** Contact address shown in the privacy policy and directory listings (Email Routing on the domain). */
  contactEmail: "contact@euroa11y.com",
} as const;
