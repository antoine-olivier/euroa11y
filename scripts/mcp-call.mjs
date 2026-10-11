// Calls scan_page on the local MCP endpoint for each URL, one at a time (Browser Run Free: 1 browser / 20 s).
// Usage: node mcp-call.mjs <endpoint> <url> [url...]
const [endpoint, ...urls] = process.argv.slice(2);
const GAP_MS = Number(process.env.GAP_MS ?? 22_000);

async function call(id, method, params) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const body = await response.text();
  const data = body.startsWith("{") ? body : body.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("");
  return JSON.parse(data);
}

for (const [index, url] of urls.entries()) {
  if (index) await new Promise((r) => setTimeout(r, GAP_MS));
  const started = Date.now();
  const out = await call(index + 1, "tools/call", { name: "scan_page", arguments: { url } });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const result = out.result ?? {};
  const text = result.content?.[0]?.text ?? JSON.stringify(out.error);
  console.log(`=== ${url} (${seconds} s)${result.isError ? " ERROR" : ""}`);
  console.log(result.isError ? text : text.split("\n").slice(0, 12).join("\n"));
  if (process.env.FULL) console.log(text);
}
