// Usage of the public server, read from the Workers Analytics Engine dataset `euroa11y_usage` (written by
// src/worker/metrics.ts: one data point per POST /mcp request, kept 3 months by Cloudflare).
//
// Usage: node scripts/usage.mjs [--days 30|90] [--json] [--print-sql]
//   no --days   both windows, 30 then 90 days
//   --json      one JSON document instead of tables
//   --print-sql only prints the queries (nothing is sent, no credentials needed)
//
// Credentials come from the environment, never from the repository:
//   CLOUDFLARE_ACCOUNT_ID   account that owns the Worker
//   CLOUDFLARE_API_TOKEN    API token with the permission "Account Analytics Read" and nothing else
//
// Columns of the dataset (metrics.ts): index1 = platform (chatgpt, claude, direct, other); blob1 = JSON-RPC method;
// blob2 = tool; blob3 = status of the call (ok, error, limit); blob4 = scan result (ok, cache, bot_protection,
// limit, error; empty when the call ran no scan); double1 = request ms; double2 = scan ms.
// Analytics Engine samples under load: counts are SUM(_sample_interval), never COUNT(), and averages are weighted.

import { pathToFileURL } from "node:url";

const DATASET = "euroa11y_usage";

/** The three readings of one window, as Analytics Engine SQL. `days` is a checked integer. */
export function queries(days) {
  const window = `timestamp > NOW() - INTERVAL '${days}' DAY`;
  return {
    // Calls per day, method and platform.
    calls: `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, blob1 AS method, index1 AS platform, SUM(_sample_interval) AS calls, SUM(_sample_interval * double1) / SUM(_sample_interval) AS avg_ms FROM ${DATASET} WHERE ${window} GROUP BY day, method, platform FORMAT JSON`,
    // Tool calls per tool and status.
    tools: `SELECT blob2 AS tool, blob3 AS status, SUM(_sample_interval) AS calls FROM ${DATASET} WHERE ${window} AND blob1 = 'tools/call' GROUP BY tool, status FORMAT JSON`,
    // Scans per result and platform, with the mean scan duration.
    scans: `SELECT blob4 AS result, index1 AS platform, SUM(_sample_interval) AS scans, SUM(_sample_interval * double2) / SUM(_sample_interval) AS avg_scan_ms FROM ${DATASET} WHERE ${window} AND blob4 != '' GROUP BY result, platform FORMAT JSON`,
  };
}

async function run(accountId, token, sql) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: sql,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).data ?? [];
}

const sortBy = (rows, ...keys) => [...rows].sort((a, b) => keys.map((key) => String(a[key]).localeCompare(String(b[key]))).find((order) => order !== 0) ?? 0);

async function main(argv) {
  const json = argv.includes("--json");
  const printOnly = argv.includes("--print-sql");
  const at = argv.indexOf("--days");
  const days = at === -1 ? [30, 90] : [Number(argv[at + 1])];
  if (!days.every((value) => Number.isInteger(value) && value > 0 && value <= 90)) {
    console.error("--days takes a whole number from 1 to 90 (Analytics Engine keeps 3 months).");
    return 2;
  }
  if (printOnly) {
    for (const value of days) for (const [name, sql] of Object.entries(queries(value))) console.log(`-- ${name}, ${value} days\n${sql}\n`);
    return 0;
  }
  const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token } = process.env;
  if (!accountId || !token) {
    console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (token with the permission Account Analytics Read).");
    return 2;
  }
  const report = {};
  for (const value of days) {
    const { calls, tools, scans } = queries(value);
    report[`${value} days`] = {
      calls: sortBy(await run(accountId, token, calls), "day", "method", "platform"),
      tools: sortBy(await run(accountId, token, tools), "tool", "status"),
      scans: sortBy(await run(accountId, token, scans), "result", "platform"),
    };
  }
  if (json) console.log(JSON.stringify(report, null, 2));
  else
    for (const [window, parts] of Object.entries(report))
      for (const [name, rows] of Object.entries(parts)) {
        console.log(`\n== ${name}, ${window}`);
        console.table(rows);
      }
  return 0;
}

// Run as a script, not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      // The message only: it never holds the token.
      console.error(`usage: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
