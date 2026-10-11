// Scanner against a local page with known defects. The test host check lets 127.0.0.1 through and treats
// `localhost` as private, so a redirect or a subresource aimed at `localhost` must be refused.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { HostCheck } from "../src/net.ts";
import { createScanner, ScanError } from "../src/scanner.ts";

const hits: string[] = [];
let server: Server;
let port = 0;

function badPage(): string {
  return `<!doctype html><html><head><title>Bad page</title><style>.low{color:#aaa;background:#fff}</style></head>
<body><main><h1>Shop</h1>
<img src="/img.png">
<p class="low">Low contrast text</p>
<form><input type="text" id="q"></form>
<a href="/x"></a>
<button></button>
<img src="http://localhost:${port}/pixel.png" alt="tracker">
<img src="/redirect" alt="redirected">
</main></body></html>`;
}

// Rewrites a built-in the scanner's page code relies on, so that every answer would be 3 million characters.
const HOSTILE_PAGE = `<!doctype html><html lang="en"><head><title>Hostile</title><script>
const huge = "x".repeat(3000000);
JSON.stringify = () => huge;
</script></head><body><main><h1>Hostile</h1></main></body></html>`;

before(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? "");
    if (req.url === "/bad.html") res.writeHead(200, { "content-type": "text/html" }).end(badPage());
    else if (req.url === "/redirect") res.writeHead(302, { location: `http://localhost:${port}/secret` }).end();
    else if (req.url === "/hop") res.writeHead(301, { location: "/bad.html" }).end();
    else if (req.url === "/secret") res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>secret</title>");
    else if (req.url === "/hostile.html") res.writeHead(200, { "content-type": "text/html" }).end(HOSTILE_PAGE);
    else if (req.url === "/doc.pdf") res.writeHead(200, { "content-type": "application/pdf" }).end("%PDF-1.4\n%%EOF\n");
    else if (req.url === "/data.json") res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end('{"a":1}');
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

const onlyLoopbackIp: HostCheck = async (hostname) => (hostname === "127.0.0.1" ? null : "private_address");
const scanner = createScanner({ checkHost: onlyLoopbackIp, navigationTimeoutMs: 15_000, anyPort: true });

after(async () => {
  await scanner.close();
  server.close();
});

test("finds the known defects and refuses the private subresource", async () => {
  const scan = await scanner.scan({ url: new URL(`http://127.0.0.1:${port}/bad.html`) });
  const ids = scan.results.violations.map((rule) => rule.id).sort();
  for (const expected of ["button-name", "color-contrast", "html-has-lang", "image-alt", "label", "link-name"]) {
    assert.ok(ids.includes(expected), `${expected} missing from ${ids.join(", ")}`);
  }
  assert.equal(scan.title, "Bad page");
  assert.equal(scan.httpStatus, 200);
  assert.ok(scan.blockedRequests >= 1);
  assert.ok(!hits.includes("/pixel.png"), "the localhost subresource must never be fetched");
  assert.ok(!hits.includes("/secret"), "a subresource redirect towards localhost must never be followed");
});

test("follows a redirect that stays on an allowed host", async () => {
  const scan = await scanner.scan({ url: new URL(`http://127.0.0.1:${port}/hop`) });
  assert.equal(new URL(scan.finalUrl).pathname, "/bad.html");
});

test("refuses a redirect towards a private host", async () => {
  hits.length = 0;
  await assert.rejects(scanner.scan({ url: new URL(`http://127.0.0.1:${port}/redirect`) }), ScanError);
  assert.ok(!hits.includes("/secret"), "the redirect target must never be fetched");
});

test("refuses a page on a non-standard port", async () => {
  const strict = createScanner({ checkHost: onlyLoopbackIp, navigationTimeoutMs: 15_000 });
  try {
    await assert.rejects(strict.scan({ url: new URL(`http://127.0.0.1:${port}/bad.html`) }), /non-standard port/);
  } finally {
    await strict.close();
  }
});

test("refuses a document that is not an HTML page, rather than reporting on the browser's viewer", async () => {
  await assert.rejects(scanner.scan({ url: new URL(`http://127.0.0.1:${port}/doc.pdf`) }), /application\/pdf document, not an HTML page.*PAC/);
  await assert.rejects(scanner.scan({ url: new URL(`http://127.0.0.1:${port}/data.json`) }), /application\/json document, not an HTML page/);
});

test("never reads back an oversized answer from a page that rewrites the built-ins", async () => {
  await assert.rejects(scanner.scan({ url: new URL(`http://127.0.0.1:${port}/hostile.html`) }), /too large or unreadable/);
});

test("refuses a private address before launching anything", async () => {
  await assert.rejects(scanner.scan({ url: new URL(`http://localhost:${port}/bad.html`) }), /private or local/);
});
