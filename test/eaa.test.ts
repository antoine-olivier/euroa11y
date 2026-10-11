// EAA scope rules: covered services, microenterprise exemption, public sector, missing figures.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkEaaScope } from "../src/eaa.ts";

const shop = { sector: "e_commerce" as const, sells_to_eu_consumers: true };

test("an online shop with 10 or more employees is in scope", () => {
  assert.equal(checkEaaScope({ ...shop, employees: 25 }).verdict, "in_scope");
  assert.equal(checkEaaScope({ ...shop, employees: 10 }).verdict, "in_scope");
});

test("a microenterprise providing services is exempt", () => {
  assert.equal(checkEaaScope({ ...shop, employees: 4, annual_turnover_eur: 800_000 }).verdict, "exempt_microenterprise");
  assert.equal(checkEaaScope({ ...shop, employees: 9, annual_turnover_eur: 5_000_000, balance_sheet_eur: 2_000_000 }).verdict, "exempt_microenterprise");
});

test("both financial figures above EUR 2 million remove the exemption", () => {
  assert.equal(checkEaaScope({ ...shop, employees: 9, annual_turnover_eur: 3_000_000, balance_sheet_eur: 2_500_000 }).verdict, "in_scope");
});

test("asks for the missing figure instead of guessing", () => {
  assert.equal(checkEaaScope(shop).verdict, "need_more_info");
  assert.equal(checkEaaScope({ ...shop, employees: 3 }).verdict, "need_more_info");
  const oneHigh = checkEaaScope({ ...shop, employees: 3, annual_turnover_eur: 4_000_000 });
  assert.equal(oneHigh.verdict, "need_more_info");
  assert.match(oneHigh.reasons.at(-1) ?? "", /balance sheet total/);
});

test("business-only and unlisted activities are out of the EAA, with a pointer to e-commerce", () => {
  assert.equal(checkEaaScope({ ...shop, sells_to_eu_consumers: false, employees: 50 }).verdict, "out_of_scope");
  const other = checkEaaScope({ sector: "other", sells_to_eu_consumers: true, employees: 50 });
  assert.equal(other.verdict, "out_of_scope");
  assert.ok(other.reasons.some((reason) => /check it again with sector e_commerce/.test(reason)));
});

test("a public body providing a listed service falls under both directives (recital 46)", () => {
  const shopOfMuseum = checkEaaScope({ ...shop, public_body: true });
  assert.equal(shopOfMuseum.verdict, "in_scope");
  assert.ok(shopOfMuseum.reasons.some((reason) => /2016\/2102/.test(reason) && /in addition/.test(reason)));
  assert.ok(shopOfMuseum.reasons.some((reason) => /microenterprise exemption does not apply/.test(reason)));
  assert.equal(checkEaaScope({ sector: "other", sells_to_eu_consumers: true, public_body: true }).verdict, "public_sector_other_law");
  assert.equal(checkEaaScope({ sector: "urban_regional_transport", sells_to_eu_consumers: true, public_body: true }).verdict, "terminals_only");
});

test("urban and regional transport: self-service terminals only, ticket sales as e-commerce", () => {
  const bus = checkEaaScope({ sector: "urban_regional_transport", sells_to_eu_consumers: true, employees: 300 });
  assert.equal(bus.verdict, "terminals_only");
  assert.ok(bus.reasons.some((reason) => /self-service terminals/.test(reason)));
  assert.ok(bus.reasons.some((reason) => /sector e_commerce/.test(reason)));
  assert.equal(checkEaaScope({ sector: "urban_regional_transport", sells_to_eu_consumers: true, employees: 4, annual_turnover_eur: 500_000 }).verdict, "exempt_microenterprise");
  assert.equal(checkEaaScope({ sector: "passenger_transport", sells_to_eu_consumers: true, employees: 300 }).verdict, "in_scope");
});

test("the exemption reminds how the figures are counted", () => {
  const micro = checkEaaScope({ ...shop, employees: 6, annual_turnover_eur: 1_200_000 });
  assert.ok(micro.reasons.some((reason) => /partner and linked enterprises/.test(reason) && /excluding VAT/.test(reason)));
});

test("every answer carries dates, sources and the disclaimer", () => {
  const result = checkEaaScope({ ...shop, employees: 25 });
  assert.ok(result.key_dates.some((line) => line.startsWith("28 June 2025")));
  assert.ok(result.key_dates.some((line) => line.startsWith("28 June 2030")));
  assert.ok(result.sources.every((source) => source.url.startsWith("https://eur-lex.europa.eu/") || source.url.startsWith("https://www.legifrance.gouv.fr/")));
  assert.match(result.disclaimer, /not legal advice/);
});
