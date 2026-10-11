// Pure helpers: tag parsing, criterion ordering, private addresses, URL parsing, RGAA index.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkPublicHost, isPrivateAddress, parsePageUrl } from "../src/net.ts";
import { loadRgaa } from "../src/rgaa.ts";
import { nativeRgaa, rgaaForRule, rgaaTopicsForRule } from "../src/rgaa-index.ts";
import { parseSetCookie } from "../src/scan-core.ts";
import { compareCriteria, criteriaFromTags, describeCriterion } from "../src/wcag.ts";

test("reads success criteria from axe tags and ignores level tags", () => {
  assert.deepEqual(criteriaFromTags(["cat.color", "wcag2aa", "wcag143", "wcag21aa", "wcag1410", "wcag2411", "wcag258", "EN-301-549"]), ["1.4.3", "1.4.10", "2.4.11", "2.5.8"]);
  assert.deepEqual(criteriaFromTags(["best-practice"]), []);
});

test("keeps level A and AA criteria only, within bounds", () => {
  // 1.4.6 Contrast (Enhanced) and 2.1.3 Keyboard (No Exception) are AAA; 9.9.9 does not exist.
  assert.deepEqual(criteriaFromTags(["wcag146", "wcag213", "wcag143", "wcag999", "wcag143"]), ["1.4.3"]);
  assert.deepEqual(criteriaFromTags([1, null, { tag: "wcag111" }, "wcag111"]), ["1.1.1"]);
  assert.deepEqual(criteriaFromTags([...Array.from({ length: 200 }, () => "x"), "wcag111"]), [], "past the first 200 tags");
  const many = ["wcag111", "wcag121", "wcag122", "wcag123", "wcag124", "wcag125", "wcag131", "wcag132", "wcag133", "wcag134", "wcag135", "wcag141"];
  assert.equal(criteriaFromTags(many).length, 10);
});

test("orders criteria numerically and names unknown ones", () => {
  assert.deepEqual(["1.4.10", "1.4.3", "1.1.1", "4.1.2"].sort(compareCriteria), ["1.1.1", "1.4.3", "1.4.10", "4.1.2"]);
  assert.deepEqual(describeCriterion("2.5.8"), { sc: "2.5.8", name: "Target Size (Minimum)", level: "AA" });
  assert.equal(describeCriterion("9.9.9").level, null);
});

test("parses Set-Cookie headers for the next redirect hop", () => {
  const from = new URL("https://www.service-public.fr/");
  assert.deepEqual(parseSetCookie("TS01=abc=def; Path=/; Secure; HttpOnly", from), { name: "TS01", value: "abc=def", domain: "www.service-public.fr", path: "/", secure: true });
  assert.equal(parseSetCookie("sid=1; Domain=.service-public.fr; Expires=Wed, 09 Jun 2027 10:18:14 GMT", from)?.domain, ".service-public.fr");
  assert.equal(parseSetCookie("sid=1; Domain=example.com", from), undefined);
  assert.equal(parseSetCookie("no-equals-sign", from), undefined);
});

test("classifies private and public addresses", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"]) assert.ok(isPrivateAddress(ip), ip);
  // Forms the URL parser produces from IPv4-mapped literals, NAT64, IPv4-compatible, site-local, 6to4, Teredo.
  for (const ip of ["[::ffff:7f00:1]", "::ffff:a9fe:a9fe", "::ffff:a00:1", "::7f00:1", "64:ff9b::7f00:1", "fec0::1", "fe80::1%eth0", "2002:7f00:1::", "2001:0:4136::1", "2001:db8::1", "1:2:3", "::"]) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ["93.184.215.14", "1.1.1.1", "2606:4700::1111", "[2a00:1450:4007:80e::200e]"]) assert.ok(!isPrivateAddress(ip), ip);
});

test("refuses localhost names and literal private IPs without DNS", async () => {
  assert.equal(await checkPublicHost("localhost"), "private_address");
  assert.equal(await checkPublicHost("app.localhost"), "private_address");
  assert.equal(await checkPublicHost("192.168.0.10"), "private_address");
  assert.equal(await checkPublicHost("[::1]"), "private_address");
});

test("parses page URLs", () => {
  assert.equal(parsePageUrl("example.com/cart").href, "https://example.com/cart");
  assert.equal(parsePageUrl("http://example.com/#top").href, "http://example.com/");
  assert.throws(() => parsePageUrl("file:///etc/passwd"), /Only http/);
  assert.throws(() => parsePageUrl("https://user:pw@example.com"), /credentials/);
  assert.throws(() => parsePageUrl(`https://${"a".repeat(64)}.com/`), /too long/);
  assert.throws(() => parsePageUrl(`https://${"abcdefghi.".repeat(26)}com/`), /too long/);
  assert.equal(parsePageUrl(`https://${"a".repeat(63)}.com/`).hostname.length, 67);
  assert.ok(String((() => { try { parsePageUrl(`ht tp://${"x".repeat(5000)}`); } catch (error) { return (error as Error).message; } })()).length < 300);
});

test("indexes RGAA criteria by WCAG success criterion", () => {
  const dir = mkdtempSync(join(tmpdir(), "rgaa-"));
  const path = join(dir, "rgaa.json");
  writeFileSync(
    path,
    JSON.stringify({
      source: "test",
      version: "4.1.2",
      criteria: [
        { id: "1.1", topic: "Images", title: "Alternative", wcag: ["1.1.1", "4.1.2"] },
        { id: "3.2", topic: "Couleurs", title: "Contraste", wcag: ["1.4.3"] },
        { id: "5.7", topic: "Tableaux", title: "En-têtes", wcag: ["1.3.1"] },
        { id: "7.1", topic: "Scripts", title: "Script", wcag: ["4.1.2"] },
      ],
    }),
  );
  const index = loadRgaa(path);
  assert.ok(index);
  assert.deepEqual(index.criteriaFor("1.1.1"), [{ id: "1.1", title: "Alternative" }]);
  assert.deepEqual(index.criteriaFor("1.4.3").map((c) => c.id), ["3.2"]);
  assert.deepEqual(index.criteriaFor("2.4.2"), []);
  assert.deepEqual(index.criterion("5.7"), { id: "5.7", title: "En-têtes" });
  assert.equal(index.criterion("9.9"), undefined);
  // Filtered by the axe rule's topics; none in common gives none, rather than every criterion of the WCAG one.
  assert.deepEqual(index.criteriaFor("4.1.2", rgaaTopicsForRule("aria-allowed-attr", ["cat.aria", "wcag412"])).map((c) => c.id), ["7.1"]);
  assert.deepEqual(index.criteriaFor("4.1.2", rgaaTopicsForRule("td-headers-attr", ["cat.tables"])), []);
  assert.equal(loadRgaa(join(dir, "missing.json")), undefined);
});

test("relates an axe rule to RGAA through its own RGAA tags first", () => {
  assert.deepEqual(nativeRgaa(["RGAA-11.9.1", "RGAA-11.9.2", "RGAA-1.1.1", "RGAA-1.1", "rgaa-2.1.1", "wcag111"]), ["11.9", "1.1"]);
  const criteria = [
    { id: "1.1", topic: "Images", title: "Alternative", wcag: ["1.1.1"] },
    { id: "5.7", topic: "Tableaux", title: "En-têtes", wcag: ["1.3.1"] },
    { id: "8.1", topic: "Éléments obligatoires", title: "Doctype", wcag: ["1.3.1"] },
  ];
  const dir = mkdtempSync(join(tmpdir(), "rgaa-"));
  writeFileSync(join(dir, "rgaa.json"), JSON.stringify({ source: "test", version: "4.1.2", criteria }));
  const index = loadRgaa(join(dir, "rgaa.json"));
  assert.ok(index);
  // Tagged by axe: its criterion only, not every criterion of WCAG 1.3.1.
  assert.deepEqual(rgaaForRule(index, "td-headers-attr", ["cat.tables", "wcag131", "RGAA-5.7.4"], ["1.3.1"]), [{ id: "5.7", title: "En-têtes" }]);
  // Untagged: the topic of its category.
  assert.deepEqual(rgaaForRule(index, "th-has-data-cells", ["cat.tables", "wcag131"], ["1.3.1"]).map((c) => c.id), ["5.7"]);
  // A tag naming a criterion RGAA 4.1.2 does not have falls back to the topics.
  assert.deepEqual(rgaaForRule(index, "image-alt", ["cat.text-alternatives", "wcag111", "RGAA-99.1.1"], ["1.1.1"]).map((c) => c.id), ["1.1"]);
  assert.deepEqual(rgaaForRule(index, "summary-name", ["cat.name-role-value", "wcag412"], ["4.1.2"]), []);
});
