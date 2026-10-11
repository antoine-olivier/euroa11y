// Who calls: ChatGPT (from OpenAI's published addresses), Claude on the web (Anthropic's), or a client on the
// user's own machine; and the list of OpenAI's addresses, bundled then loaded again.
import assert from "node:assert/strict";
import { test } from "node:test";
import snapshot from "../data/chatgpt-connectors.json" with { type: "json" };
import { addressValue, createRangeList, identifyCaller, parseCidr, parseConnectorList } from "../src/callers.ts";

const OPENAI = parseConnectorList(snapshot) ?? [];

test("reads the list OpenAI published, and nothing that only looks like it", () => {
  assert.equal(OPENAI.length, 278, "ranges published on 2026-09-22");
  assert.equal(parseConnectorList("<html>Just a moment...</html>"), null);
  assert.equal(parseConnectorList({ prefixes: [{ ipv4Prefix: "20.0.0.0/24" }] }), null, "too few ranges for the real list");
  const ranges = (count: number, extra: unknown[] = []) => ({ prefixes: [...Array.from({ length: count }, (_, index) => ({ ipv4Prefix: `20.0.${index}.0/24` })), ...extra] });
  assert.equal(parseConnectorList(ranges(12, [{ ipv4Prefix: "0.0.0.0/0" }, { ipv4Prefix: "nonsense" }, { ipv6Prefix: "2001:db8::/16" }, null]))?.length, 12, "too wide or unreadable: skipped");
  assert.equal(parseConnectorList(ranges(10_001)), null);
});

test("parses address ranges in both families", () => {
  assert.equal(addressValue("1.2.3.4"), addressValue("::ffff:1.2.3.4"));
  assert.equal(addressValue("not an address"), null);
  assert.deepEqual(parseCidr("10.0.0.0/8"), { prefix: (0xffffn << 8n) | 10n, bits: 104 });
  assert.equal(parseCidr("10.0.0.0/33"), null);
  assert.equal(parseCidr("2001:db8::/129"), null);
  assert.equal(parseCidr("2001:db8::"), null, "a range needs its length");
});

test("trusts ChatGPT's user identifier only from OpenAI's addresses", () => {
  const [first] = snapshot.prefixes;
  const inside = first?.ipv4Prefix.split("/")[0] ?? "";
  assert.deepEqual(identifyCaller(inside, { "openai/subject": "v1/abc" }, OPENAI), { platform: "chatgpt", id: "openai:v1/abc" });
  assert.deepEqual(identifyCaller(inside, {}, OPENAI), { platform: "chatgpt", address: `ip:${inside.split(".").reduce((n, p) => n * 256 + Number(p), 0)}` }, "no identifier: limited per server address only");
  assert.deepEqual(identifyCaller(inside, { "openai/subject": "x".repeat(257) }, OPENAI).id, undefined);
  assert.deepEqual(identifyCaller("203.0.113.9", { "openai/subject": "v1/abc" }, OPENAI), { platform: "direct", id: `ip:${203 * 2 ** 24 + 113 * 2 ** 8 + 9}` }, "forged elsewhere: ignored");
});

test("counts Claude on the web together, and a direct client by its own address", () => {
  assert.deepEqual(identifyCaller("160.79.104.10", undefined, OPENAI), { platform: "claude", address: `ip:${160 * 2 ** 24 + 79 * 2 ** 16 + 104 * 2 ** 8 + 10}` });
  assert.deepEqual(identifyCaller("160.79.112.1", undefined, OPENAI), { platform: "direct", id: `ip:${160 * 2 ** 24 + 79 * 2 ** 16 + 112 * 2 ** 8 + 1}` }, "just outside 160.79.104.0/21");
  assert.equal(identifyCaller("::ffff:203.0.113.9", undefined, OPENAI).id, identifyCaller("203.0.113.9", undefined, OPENAI).id);
  const home = identifyCaller("2a01:cb00:1234:5678::1", undefined, OPENAI);
  assert.deepEqual(home, { platform: "direct", id: "ip6:2a01cb0012345678" });
  assert.equal(identifyCaller("2a01:cb00:1234:5678:aaaa:bbbb:cccc:dddd", undefined, OPENAI).id, home.id, "one /64 network, one client");
  assert.deepEqual(identifyCaller(undefined, undefined, OPENAI), { platform: "direct", id: "unknown" });
  assert.deepEqual(identifyCaller("garbage", undefined, OPENAI), { platform: "direct", id: "unknown" });
});

test("loads OpenAI's list again once a day, once an hour after a failure", async () => {
  let now = 0;
  const lines: string[] = [];
  const replies: Array<() => Promise<unknown>> = [() => Promise.reject(new Error("HTTP 403")), async () => "<html>", async () => ({ prefixes: snapshot.prefixes.slice(0, 20) })];
  const list = createRangeList(snapshot, () => replies.shift()!(), { now: () => now, log: (line) => lines.push(line) });
  assert.equal(list.current().length, 278, "the bundled copy until a load succeeds");
  await list.reload();
  assert.equal(list.reload(), undefined, "not due again before an hour");
  now = 3600_000;
  await list.reload();
  now = 7200_000;
  await list.reload();
  assert.equal(list.current().length, 20);
  now = 7200_000 + 23 * 3600_000;
  assert.equal(list.reload(), undefined, "not due again before a day");
  assert.deepEqual(lines, ["ChatGPT list not loaded (HTTP 403), 278 ranges kept", "ChatGPT list unreadable, 278 ranges kept", "ChatGPT list loaded, 20 ranges"]);
});
