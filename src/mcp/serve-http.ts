// Local MCP HTTP entry point, for the ChatGPT trial (developer mode) behind a temporary tunnel.
//   node src/mcp/serve-http.ts            server only (local trial), 127.0.0.1:8790
//   node src/mcp/serve-http.ts --tunnel   server + cloudflared quick tunnel, public URL printed
// Variables: A11Y_PORT, A11Y_HTTP_TOKEN (secret path token, random otherwise), A11Y_BROWSER (Chromium-based
// browser executable), A11Y_CLOUDFLARED (cloudflared path).
// The log shows the MCP method and tool name only, never the arguments (scanned URLs) nor the token.
import { spawn, type ChildProcess } from "node:child_process";
import { localhostAllowedHostnames, localhostAllowedOrigins } from "@modelcontextprotocol/server";
import { checkPublicHost } from "../net.ts";
import { BRAND } from "../brand.ts";
import { loadRgaa } from "../rgaa.ts";
import { createScanner } from "../scanner.ts";
import { createHttpEntry } from "./http.ts";
import { serveNode } from "./http-node.ts";
import { createMcpServer } from "./server.ts";

const port = Number(process.env.A11Y_PORT ?? 8790);
const token = process.env.A11Y_HTTP_TOKEN ?? crypto.randomUUID().replaceAll("-", "");
const mcpPath = `/${token}/mcp`;
const withTunnel = process.argv.includes("--tunnel");
const MAX_BODY_BYTES = 256_000;

const scanner = createScanner({ checkHost: checkPublicHost });
const rgaa = loadRgaa();

const allowedHosts = new Set(localhostAllowedHostnames());
const allowedOrigins = new Set([...localhostAllowedOrigins(), "chatgpt.com", "chat.openai.com"]);
let publicBase: string | undefined;
const localBase = `http://127.0.0.1:${port}`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

function statusPage(): Response {
  const connector = publicBase ? `${publicBase}${mcpPath}` : "(tunnel not started)";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${BRAND.name} test server</title>
<style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:44rem;padding:1.5rem 1rem}code{overflow-wrap:anywhere;font-size:.95em}</style></head>
<body><h1>${BRAND.name} test server</h1>
<p>ChatGPT connector URL (developer mode): <code>${escapeHtml(connector)}</code></p>
<p>Local MCP URL: <code>${escapeHtml(`${localBase}${mcpPath}`)}</code></p>
<p>RGAA mapping: ${rgaa ? `loaded (RGAA ${escapeHtml(rgaa.version)})` : "not available"}.</p>
<p>This page is only served on 127.0.0.1, never through the tunnel.</p></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function extraRoutes(request: Request, url: URL): Response | undefined {
  // Status page: never through the tunnel (cloudflared adds Cf-Connecting-Ip).
  if (url.pathname === "/" && request.method === "GET" && !request.headers.has("cf-connecting-ip")) return statusPage();
  return undefined;
}

const entry = createHttpEntry({
  mcpPath,
  allowedHosts,
  allowedOrigins,
  maxBodyBytes: MAX_BODY_BYTES,
  maxConcurrent: 6,
  factory: () => createMcpServer({ scanner, ...(rgaa ? { rgaa } : {}) }),
  extraRoutes,
  onerror: (error) => console.error(`[mcp] ${error.message}`),
});

/** Minimal log: JSON-RPC method and tool name, without arguments or token. */
async function describe(request: Request): Promise<string> {
  if (request.method !== "POST") return "";
  try {
    const body = (await request.clone().json()) as { method?: string; params?: { name?: string } } | Array<{ method?: string }>;
    if (Array.isArray(body)) return ` batch(${body.length})`;
    return ` ${body.method ?? "?"}${body.params?.name ? ` ${body.params.name}` : ""}`;
  } catch {
    return "";
  }
}

const logged = {
  async fetch(request: Request): Promise<Response> {
    const what = await describe(request);
    const started = Date.now();
    const response = await entry.fetch(request);
    const path = new URL(request.url).pathname.replace(token, "…");
    const via = request.headers.has("cf-connecting-ip") ? "tunnel" : "local";
    console.log(`${new Date().toISOString()} ${via} ${request.method} ${path}${what} → ${response.status} (${Date.now() - started} ms)`);
    return response;
  },
  close: () => entry.close(),
};

const server = await serveNode(logged, { port, maxBodyBytes: MAX_BODY_BYTES, onerror: (error) => console.error(`[http] ${error.message}`) });
console.log(`${BRAND.name} test server on ${localBase} (status page: ${localBase}/)`);
console.log(`Local MCP URL: ${localBase}${mcpPath}`);
console.log(`RGAA mapping: ${rgaa ? "loaded" : "not available"}`);

let tunnel: ChildProcess | undefined;
if (withTunnel) {
  tunnel = spawn(process.env.A11Y_CLOUDFLARED ?? "cloudflared", ["tunnel", "--no-autoupdate", "--url", localBase], { stdio: ["ignore", "pipe", "pipe"] });
  const watch = (chunk: Buffer) => {
    const found = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString("utf8"));
    if (!found || publicBase) return;
    publicBase = found[0];
    const host = new URL(publicBase).hostname;
    allowedHosts.add(host);
    allowedOrigins.add(host);
    console.log(`Tunnel ready. ChatGPT connector URL: ${publicBase}${mcpPath}`);
  };
  tunnel.stdout?.on("data", watch);
  tunnel.stderr?.on("data", watch);
  tunnel.on("exit", (code) => console.log(`cloudflared stopped (code ${code}).`));
  tunnel.on("error", (error) => console.error(`cloudflared could not start: ${error.message}`));
}

async function shutdown(): Promise<void> {
  tunnel?.kill();
  await logged.close().catch(() => undefined);
  server.close();
  await scanner.close().catch(() => undefined);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
