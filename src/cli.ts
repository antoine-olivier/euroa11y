// Command line scan, same engine and report as the plugin:
//   node src/cli.ts <url> [--rgaa] [--mobile] [--best-practices] [--json]
import { checkPublicHost, parsePageUrl } from "./net.ts";
import { buildReport, renderMarkdown } from "./report.ts";
import { loadRgaa } from "./rgaa.ts";
import { createScanner } from "./scanner.ts";

const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith("--"));
if (!target) {
  console.error("usage: node src/cli.ts <url> [--rgaa] [--mobile] [--best-practices] [--json]");
  process.exit(1);
}
const scanner = createScanner({ checkHost: checkPublicHost });
try {
  const started = Date.now();
  const raw = await scanner.scan({ url: parsePageUrl(target), bestPractices: args.includes("--best-practices"), ...(args.includes("--mobile") ? { viewport: { width: 390, height: 844 } } : {}) });
  const rgaa = args.includes("--rgaa") ? loadRgaa() : undefined;
  const report = buildReport(raw, rgaa ? { rgaa } : {});
  console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : renderMarkdown(report));
  console.error(`(${Date.now() - started} ms)`);
} catch (error) {
  console.error(`Error: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await scanner.close();
}
