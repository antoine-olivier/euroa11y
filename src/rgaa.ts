// Node loader of the RGAA 4.1.2 criteria file (`data/rgaa-4.1.2-wcag.json`, extracted with its source URL);
// the index itself is built by `rgaa-index.ts`, shared with the Workers build.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildRgaaIndex, type RgaaData, type RgaaIndex } from "./rgaa-index.ts";

export type { RgaaCriterion, RgaaIndex } from "./rgaa-index.ts";

export const RGAA_DATA_PATH = fileURLToPath(new URL("../data/rgaa-4.1.2-wcag.json", import.meta.url));

export function loadRgaa(path = RGAA_DATA_PATH): RgaaIndex | undefined {
  if (!existsSync(path)) return undefined;
  return buildRgaaIndex(JSON.parse(readFileSync(path, "utf8")) as RgaaData);
}
