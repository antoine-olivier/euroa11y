// Node scanner: a headless Chromium-based browser on this machine (Edge by default), shared by the scans,
// at most `maxConcurrent` at once. The scan itself, network guard included, is in scan-core.ts.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, type Browser } from "playwright-core";
import type { HostCheck } from "./address.ts";
import { BRAND } from "./brand.ts";
import { precheck, scanInBrowser, ScanError, type Axe, type CoreOptions, type RawScan, type ScanRequest, type Scanner } from "./scan-core.ts";

export { ScanError, type RawScan, type ScanRequest, type Scanner };

const require = createRequire(import.meta.url);
export const AXE: Axe = {
  source: readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"),
  version: (require("axe-core/package.json") as { version: string }).version,
};
export const AXE_VERSION = AXE.version;

const DEFAULT_BROWSER = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
export const USER_AGENT_SUFFIX = `${BRAND.slug}/${BRAND.version} (accessibility check requested by a user)`;

export interface ScannerOptions extends Omit<CoreOptions, "axe" | "userAgent"> {
  checkHost: HostCheck;
  /** Chromium-based browser executable; `A11Y_BROWSER` or the installed Edge otherwise. */
  executablePath?: string;
  maxConcurrent?: number;
}

export function createScanner(options: ScannerOptions): Scanner {
  const maxConcurrent = options.maxConcurrent ?? 2;
  // Ordinary desktop agent (some sites refuse "HeadlessChrome"), followed by an honest product token.
  const userAgent = (version: string) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36 Edg/${version} ${USER_AGENT_SUFFIX}`;
  let browser: Promise<Browser> | undefined;
  let active = 0;
  const waiting: Array<() => void> = [];

  function getBrowser(): Promise<Browser> {
    if (!browser) {
      const launching = chromium.launch({ executablePath: options.executablePath ?? process.env.A11Y_BROWSER ?? DEFAULT_BROWSER, headless: true });
      browser = launching;
      launching.then(
        (instance) => instance.on("disconnected", () => {
          if (browser === launching) browser = undefined;
        }),
        () => {
          if (browser === launching) browser = undefined;
        },
      );
    }
    return browser;
  }

  async function acquire(): Promise<void> {
    if (active < maxConcurrent) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  }

  function release(): void {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  }

  return {
    async scan(request) {
      await acquire();
      try {
        await precheck(request.url, options.checkHost, options.anyPort);
        const instance = await getBrowser().catch((error: Error) => {
          throw new ScanError(`The scanning browser could not start (${error.message.split("\n")[0]}).`);
        });
        return await scanInBrowser(instance, request, { ...options, axe: AXE, userAgent });
      } finally {
        release();
      }
    },
    async close() {
      const current = browser;
      browser = undefined;
      if (current) await (await current.catch(() => undefined))?.close();
    },
  };
}
