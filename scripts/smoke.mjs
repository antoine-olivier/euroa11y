// Checks the Worker's routes on a running server, wrangler dev or production; starts no scan (audit A1-18).
// Usage: node scripts/smoke.mjs <base>, e.g. http://localhost:8791 or https://euroa11y.com
import { readFileSync } from "node:fs";

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base) {
  console.error("Usage: node scripts/smoke.mjs <base>");
  process.exit(2);
}
const axeVersion = JSON.parse(readFileSync(new URL("../node_modules/axe-core/package.json", import.meta.url), "utf8")).version;
const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
let failures = 0;

function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

/** JSON-RPC answer of a response, sent as JSON or as one event of a stream. */
async function rpc(response) {
  const body = await response.text();
  const data = body.startsWith("{") ? body : body.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5)).join("");
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

const PAGES = [
  ["/", "text/html"],
  ["/docs", "text/html"],
  ["/privacy", "text/html"],
  ["/terms", "text/html"],
  ["/fonts/atkinson-next-5.3.0.woff2", "font/woff2"],
  ["/fonts/atkinson-mono-5.3.0.woff2", "font/woff2"],
  ["/favicon.svg", "image/svg+xml"],
  ["/icon-512.png", "image/png"],
  ["/robots.txt", "text/plain"],
  [`/axe/${axeVersion}/axe.min.js`, "text/javascript"],
];
for (const [path, type] of PAGES) {
  const response = await fetch(base + path);
  await response.arrayBuffer();
  const got = `${response.status} ${response.headers.get("content-type")}`;
  check(`GET ${path}`, response.status === 200 && (response.headers.get("content-type") ?? "").startsWith(type), got);
  if (base.startsWith("https:")) check(`  HSTS on ${path}`, Boolean(response.headers.get("strict-transport-security")));
}

const axe = await fetch(`${base}/axe/${axeVersion}/axe.min.js`, { headers: { origin: "https://example.com" } });
await axe.arrayBuffer();
check("axe-core readable cross-origin", axe.headers.get("access-control-allow-origin") === "*" && axe.headers.get("cross-origin-resource-policy") === "cross-origin");

const missing = await fetch(`${base}/nope`);
await missing.arrayBuffer();
check("GET /nope is a 404 page", missing.status === 404 && (missing.headers.get("content-type") ?? "").startsWith("text/html"), `${missing.status} ${missing.headers.get("content-type")}`);

const slash = await fetch(`${base}/docs/`, { redirect: "manual" });
await slash.arrayBuffer();
check("GET /docs/ redirected to /docs", slash.status === 308 && (slash.headers.get("location") ?? "").endsWith("/docs"), `${slash.status} ${slash.headers.get("location")}`);

for (const path of ["/mcp", "/mcp/"]) {
  const list = await fetch(base + path, { method: "POST", headers: MCP_HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  const answer = await rpc(list);
  const tools = answer?.result?.tools?.map((tool) => tool.name) ?? [];
  check(`POST ${path} tools/list`, tools.includes("scan_page") && tools.includes("check_eaa_scope"), `${list.status} ${tools.join(",")}`);
}

const big = await fetch(`${base}/mcp`, { method: "POST", headers: MCP_HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(300_000) } }) });
const bigAnswer = await rpc(big);
check("oversized body: 413 in JSON-RPC", big.status === 413 && bigAnswer?.error?.code === -32600, `${big.status} ${bigAnswer?.error?.code}`);

const batch = await fetch(`${base}/mcp`, { method: "POST", headers: MCP_HEADERS, body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }]) });
const batchAnswer = await rpc(batch);
check("batch: 400 in JSON-RPC", batch.status === 400 && batchAnswer?.error?.code === -32600, `${batch.status} ${batchAnswer?.error?.code}`);

if (base.startsWith("https:")) {
  const plain = await fetch(base.replace(/^https:/, "http:") + "/docs", { redirect: "manual" });
  check("http redirected to https", plain.status >= 300 && plain.status < 400 && (plain.headers.get("location") ?? "").startsWith("https:"), `${plain.status} ${plain.headers.get("location")}`);
}

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
