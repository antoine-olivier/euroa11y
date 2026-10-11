// The caller a scan is counted against, through the MCP handler as the Worker builds it: the address from the
// request Cloudflare received, ChatGPT's user identifier from the tool call's `_meta`.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import snapshot from "../data/chatgpt-connectors.json" with { type: "json" };
import { callerOf, parseConnectorList, type Caller } from "../src/callers.ts";
import { createHttpEntry } from "../src/mcp/http.ts";
import { createMcpServer } from "../src/mcp/server.ts";
import { ScanError, type Scanner } from "../src/scan-core.ts";

const OPENAI = parseConnectorList(snapshot) ?? [];
const seen: Array<Caller | undefined> = [];
const scanner: Scanner = {
  async scan(request) {
    seen.push(request.caller);
    throw new ScanError("Stopped by the test.");
  },
  async close() {},
};
const entry = createHttpEntry({
  mcpPath: "/mcp",
  allowedHosts: new Set(["euroa11y.com"]),
  allowedOrigins: new Set(),
  factory: ({ requestInfo }) => createMcpServer({ scanner, callerOf: callerOf(requestInfo, () => OPENAI) }),
});

after(() => entry.close());

/** One scan_page call from `address`; the text of the tool result. */
async function scanFrom(address: string, meta?: Record<string, unknown>): Promise<string> {
  const response = await entry.fetch(
    new Request("https://euroa11y.com/mcp", {
      method: "POST",
      headers: { host: "euroa11y.com", "cf-connecting-ip": address, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "scan_page", arguments: { url: "https://example.com/" }, ...(meta ? { _meta: meta } : {}) } }),
    }),
  );
  const raw = await response.text();
  const payload = response.headers.get("content-type")?.includes("text/event-stream") ? (raw.split("\n").filter((line) => line.startsWith("data:")).at(-1)?.slice(5) ?? "null") : raw;
  return (JSON.parse(payload) as { result?: { content?: Array<{ text?: string }> } }).result?.content?.[0]?.text ?? raw;
}

test("each scan is counted against the caller the request comes from", async () => {
  const chatgpt = snapshot.prefixes[0]?.ipv4Prefix.split("/")[0] ?? "";
  assert.equal(await scanFrom("203.0.113.9"), "Error: Stopped by the test.");
  await scanFrom(chatgpt, { "openai/subject": "v1/abc" });
  await scanFrom("203.0.113.9", { "openai/subject": "v1/abc" });
  await scanFrom("160.79.104.10");
  assert.deepEqual(seen, [
    { platform: "direct", id: "ip:3405803785" },
    { platform: "chatgpt", id: "openai:v1/abc" },
    { platform: "direct", id: "ip:3405803785" },
    { platform: "claude", address: "ip:2689558538" },
  ]);
});
