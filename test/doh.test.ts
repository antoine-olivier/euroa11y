// Host check of the Workers build: DNS over HTTPS answers simulated by a fake fetcher.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDohHostCheck, memoHostCheck, type Fetcher } from "../src/dns-doh.ts";

function fakeDoh(records: Record<string, { A?: string[]; AAAA?: string[]; status?: number }>, calls: string[] = []): Fetcher {
  return async (input) => {
    const url = new URL(input);
    const name = url.searchParams.get("name") ?? "";
    const type = url.searchParams.get("type") as "A" | "AAAA";
    calls.push(`${name}/${type}`);
    const entry = records[name];
    const data = entry?.[type] ?? [];
    const body = { Status: entry ? (entry.status ?? 0) : 3, Answer: data.map((address) => ({ type: type === "A" ? 1 : 28, data: address })) };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/dns-json" } });
  };
}

test("allows a host whose addresses are all public", async () => {
  const check = createDohHostCheck({ fetcher: fakeDoh({ "shop.example": { A: ["93.184.215.14"], AAAA: ["2606:4700::1111"] } }) });
  assert.equal(await check("shop.example"), null);
});

test("refuses a host with one private address among public ones", async () => {
  const check = createDohHostCheck({ fetcher: fakeDoh({ "mixed.example": { A: ["93.184.215.14", "10.0.0.5"] } }) });
  assert.equal(await check("mixed.example"), "private_address");
});

test("reports unknown names and resolver failures as DNS errors", async () => {
  assert.equal(await createDohHostCheck({ fetcher: fakeDoh({}) })("nowhere.example"), "dns");
  const failing: Fetcher = async () => new Response("busy", { status: 503 });
  assert.equal(await createDohHostCheck({ fetcher: failing })("shop.example"), "dns");
});

test("decides literals and localhost names without any lookup", async () => {
  const calls: string[] = [];
  const check = createDohHostCheck({ fetcher: fakeDoh({}, calls) });
  assert.equal(await check("localhost"), "private_address");
  assert.equal(await check("[::1]"), "private_address");
  assert.equal(await check("169.254.169.254"), "private_address");
  assert.equal(await check("1.1.1.1"), null);
  assert.deepEqual(calls, []);
});

test("memoises verdicts for one scan", async () => {
  const calls: string[] = [];
  const check = memoHostCheck(createDohHostCheck({ fetcher: fakeDoh({ "cdn.example": { A: ["1.1.1.1"] } }, calls) }));
  await check("cdn.example");
  await check("CDN.example");
  assert.equal(calls.length, 2, "one A and one AAAA lookup only");
});
