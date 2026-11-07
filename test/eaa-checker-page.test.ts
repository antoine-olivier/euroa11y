// Audit n° 29: /eaa-checker answers in the browser, with the decision of src/eaa.ts, and sends nothing anywhere.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { EAA_SECTORS, checkEaaScope } from "../src/eaa.ts";
import type { EaaInput } from "../src/eaa.ts";
import { EAA_SCRIPT, EAA_SCRIPT_HASH, VERDICT_LABELS } from "../src/eaa-script.ts";
import { COPY_SCRIPT, COPY_SCRIPT_HASH, docsPage, eaaCheckerPage, termsPage } from "../src/pages.ts";
import { EAA_VERDICTS } from "../src/eaa.ts";

test("the script hash is the hash of the script, and the page allows exactly the two scripts", async () => {
  assert.equal(EAA_SCRIPT_HASH, `sha256-${createHash("sha256").update(EAA_SCRIPT, "utf8").digest("base64")}`);
  const response = eaaCheckerPage();
  assert.equal(response.status, 200);
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.ok(csp.includes(`script-src '${COPY_SCRIPT_HASH}' '${EAA_SCRIPT_HASH}';`));
  assert.ok(csp.includes("default-src 'none'") && csp.includes("form-action 'none'") && !csp.includes("connect-src"), "nothing typed can leave the page");
  assert.ok(!/script-src[^;]*https?:/.test(csp));
  const html = await response.text();
  assert.ok(html.includes(`<script>${COPY_SCRIPT}</script>`) && html.includes(`<script>${EAA_SCRIPT}</script>`));
  assert.equal(html.match(/<h1>/g)?.length, 1);
  assert.ok(html.includes('<link rel="canonical" href="https://euroa11y.com/eaa-checker">'));
});

test("every verdict has a label", () => {
  assert.deepEqual(Object.keys(VERDICT_LABELS).sort(), [...EAA_VERDICTS].sort());
});

// The script defines eaaCheck at its top; with a document that has no form it does nothing else.
const eaaCheck = new Function("document", `${EAA_SCRIPT}\nreturn eaaCheck;`)({ getElementById: () => null }) as (input: EaaInput) => unknown;

test("the script gives the same answer as checkEaaScope for every combination of answers", () => {
  const employees = [undefined, 0, 4, 9, 10, 250];
  const money = [undefined, 0, 1_999_999, 2_000_000, 2_000_001, 5_000_000];
  let compared = 0;
  for (const sector of EAA_SECTORS) {
    for (const sells of [true, false]) {
      for (const publicBody of [undefined, false, true]) {
        for (const people of employees) {
          for (const turnover of money) {
            for (const balance of money) {
              const input: EaaInput = { sector, sells_to_eu_consumers: sells, public_body: publicBody, employees: people, annual_turnover_eur: turnover, balance_sheet_eur: balance };
              assert.deepEqual(eaaCheck(input), checkEaaScope(input), JSON.stringify(input));
              compared += 1;
            }
          }
        }
      }
    }
  }
  assert.equal(compared, 8 * 2 * 3 * 6 * 6 * 6);
});

// The form code runs against a stub DOM: elements are created on demand, radios are chosen by name.
class Stub {
  hidden = false;
  value = "";
  checked = false;
  textContent = "";
  href = "";
  kids: Stub[] = [];
  attrs = new Map<string, string>();
  id: string;
  page: StubPage;
  constructor(id: string, page: StubPage) {
    this.id = id;
    this.page = page;
  }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  removeAttribute(name: string) { this.attrs.delete(name); }
  addEventListener(type: string, listener: (event: { preventDefault(): void }) => void) { this.page.listeners.set(type, listener); }
  replaceChildren(...kids: Stub[]) { this.kids = kids; }
  append(kid: Stub) { this.kids.push(kid); }
  focus() { this.page.focused = this.id; }
  querySelector(selector: string) { return this.page.radios.get(/name="(\w+)"/.exec(selector)?.[1] ?? "") ?? null; }
  get elements() { return { publicbody: this.page.get("eaa-publicbody") }; }
}
class StubPage {
  els = new Map<string, Stub>();
  radios = new Map<string, { value: string }>();
  listeners = new Map<string, (event: { preventDefault(): void }) => void>();
  focused = "";
  get(id: string): Stub { let el = this.els.get(id); if (!el) { el = new Stub(id, this); this.els.set(id, el); } return el; }
  getElementById = (id: string) => this.get(id);
  createElement = () => new Stub("", this);
  submit() { this.listeners.get("submit")?.({ preventDefault() {} }); }
}
const stubbed = () => {
  const page = new StubPage();
  new Function("document", EAA_SCRIPT)(page);
  return page;
};

test("the form script shows the form, answers, and moves the focus to the result heading", () => {
  const page = stubbed();
  assert.equal(page.get("eaa-form").hidden, false);
  assert.equal(page.get("eaa-nojs").hidden, true);
  page.radios.set("sector", { value: "e_commerce" });
  page.radios.set("consumers", { value: "yes" });
  page.get("eaa-employees").value = "6";
  page.get("eaa-turnover").value = "1 200 000";
  page.submit();
  assert.equal(page.get("eaa-verdict").textContent, VERDICT_LABELS.exempt_microenterprise);
  assert.equal(page.get("eaa-result").hidden, false);
  assert.equal(page.get("eaa-more").hidden, false);
  assert.equal(page.focused, "eaa-verdict");
  assert.equal(page.get("eaa-sources").kids.length, 3);
});

test("a comma or a decimal point is an error, never a number: 1200000,50 does not become 120000050", () => {
  for (const [employees, turnover, wrong] of [["9,5", "", "eaa-employees"], ["6", "1200000,50", "eaa-turnover"], ["6", "1,200,000", "eaa-turnover"], ["6", "1.5", "eaa-turnover"]]) {
    const page = stubbed();
    page.radios.set("sector", { value: "e_commerce" });
    page.radios.set("consumers", { value: "yes" });
    page.get("eaa-employees").value = employees ?? "";
    page.get("eaa-turnover").value = turnover ?? "";
    page.submit();
    assert.equal(page.get("eaa-verdict").textContent, "Check the form", `${employees} / ${turnover}`);
    assert.equal(page.get("eaa-more").hidden, true);
    assert.equal(page.get(wrong ?? "").attrs.get("aria-invalid"), "true");
    assert.equal(page.get(`${wrong}-err`).hidden, false);
    assert.equal(page.get(wrong ?? "").attrs.get("aria-describedby"), `${wrong}-hint ${wrong}-err`);
    assert.ok(page.get(`${wrong}-err`).textContent.includes("digits only"));
  }
});

test("the error of a field goes away once the field is corrected, and an empty form names the two missing answers", () => {
  const page = stubbed();
  page.submit();
  assert.equal(page.get("eaa-reasons").kids.length, 2);
  assert.equal(page.focused, "eaa-verdict");
  page.radios.set("sector", { value: "e_commerce" });
  page.radios.set("consumers", { value: "yes" });
  page.get("eaa-employees").value = "abc";
  page.submit();
  assert.equal(page.get("eaa-employees").attrs.get("aria-invalid"), "true");
  page.get("eaa-employees").value = "12";
  page.submit();
  assert.equal(page.get("eaa-employees").attrs.has("aria-invalid"), false);
  assert.equal(page.get("eaa-employees-err").hidden, true);
  assert.equal(page.get("eaa-employees").attrs.get("aria-describedby"), "eaa-employees-hint");
  assert.equal(page.get("eaa-verdict").textContent, VERDICT_LABELS.in_scope);
});

test("the form is hidden until the script runs, and the page keeps the rule and the tool without it", async () => {
  const html = await eaaCheckerPage().text();
  assert.ok(/<form id="eaa-form" novalidate hidden /.test(html));
  assert.ok(html.includes('<p id="eaa-nojs">'));
  assert.ok(html.includes("<h2 id=\"rule\">") && html.includes("check_eaa_scope"));
  assert.ok(!/<form[^>]* (action|method)=/.test(html), "the form has no destination");
});

test("every field has a label, the groups have a legend, and the sector list is the tool's", async () => {
  const html = await eaaCheckerPage().text();
  for (const id of ["eaa-employees", "eaa-turnover", "eaa-balance", "eaa-publicbody", "eaa-sector-first", "eaa-consumers-first"]) assert.ok(html.includes(`<label for="${id}">`), id);
  assert.equal(html.match(/<legend>/g)?.length, 3);
  assert.equal(html.match(/name="sector"/g)?.length, EAA_SECTORS.length);
  assert.ok(/<section id="eaa-result" aria-labelledby="eaa-verdict" hidden>/.test(html));
});

test("the docs and every footer point to the checker", async () => {
  assert.ok((await docsPage("https://euroa11y.com/mcp").text()).includes('<a href="/eaa-checker">EAA checker</a>'));
  assert.ok((await termsPage("2026-10-04").text()).includes('<a href="/eaa-checker">EAA checker</a>'));
});
