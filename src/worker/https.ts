// HTTPS only. The zone settings "Always Use HTTPS" and HSTS need a token the deploy login lacks (zone read
// only, 2026-10-04), so the Worker redirects plain HTTP itself and sends HSTS over HTTPS. One day at first:
// raise it once the domain has run on HTTPS only for a while. Under `wrangler dev` the Worker sees https as
// well (`dev.upstream_protocol` in wrangler.jsonc).
export const HSTS_HEADER = "max-age=86400";

/** 308 to the same address over https (method and body kept for POST /mcp); undefined over HTTPS. */
export function httpsRedirect(url: URL): Response | undefined {
  if (url.protocol !== "http:") return undefined;
  const target = new URL(url.href);
  target.protocol = "https:";
  // Cloudflare also proxies HTTP on 8080, 8880…, which have no HTTPS twin: always send to 443.
  target.port = "";
  return new Response(null, { status: 308, headers: { location: target.href } });
}

/** The same response with the HSTS header; the body (JSON or event stream) is passed through. */
export function withHsts(response: Response): Response {
  const out = new Response(response.body, response);
  out.headers.set("strict-transport-security", HSTS_HEADER);
  return out;
}
