// WCAG success criteria: names and levels, and parsing of axe-core tags (`wcag111`, `wcag1410`, `wcag258`).
// A and AA criteria of WCAG 2.2, plus 4.1.1 (removed in 2.2, still tagged by some axe rules). The scan
// targets level AA: AAA criteria that axe rules also carry (2.1.3, 1.4.6…) are left out of the report.

export type Level = "A" | "AA" | "AAA";

export const CRITERIA: Record<string, { name: string; level: Level }> = {
  "1.1.1": { name: "Non-text Content", level: "A" },
  "1.2.1": { name: "Audio-only and Video-only (Prerecorded)", level: "A" },
  "1.2.2": { name: "Captions (Prerecorded)", level: "A" },
  "1.2.3": { name: "Audio Description or Media Alternative (Prerecorded)", level: "A" },
  "1.2.4": { name: "Captions (Live)", level: "AA" },
  "1.2.5": { name: "Audio Description (Prerecorded)", level: "AA" },
  "1.3.1": { name: "Info and Relationships", level: "A" },
  "1.3.2": { name: "Meaningful Sequence", level: "A" },
  "1.3.3": { name: "Sensory Characteristics", level: "A" },
  "1.3.4": { name: "Orientation", level: "AA" },
  "1.3.5": { name: "Identify Input Purpose", level: "AA" },
  "1.4.1": { name: "Use of Color", level: "A" },
  "1.4.2": { name: "Audio Control", level: "A" },
  "1.4.3": { name: "Contrast (Minimum)", level: "AA" },
  "1.4.4": { name: "Resize Text", level: "AA" },
  "1.4.5": { name: "Images of Text", level: "AA" },
  "1.4.10": { name: "Reflow", level: "AA" },
  "1.4.11": { name: "Non-text Contrast", level: "AA" },
  "1.4.12": { name: "Text Spacing", level: "AA" },
  "1.4.13": { name: "Content on Hover or Focus", level: "AA" },
  "2.1.1": { name: "Keyboard", level: "A" },
  "2.1.2": { name: "No Keyboard Trap", level: "A" },
  "2.1.4": { name: "Character Key Shortcuts", level: "A" },
  "2.2.1": { name: "Timing Adjustable", level: "A" },
  "2.2.2": { name: "Pause, Stop, Hide", level: "A" },
  "2.3.1": { name: "Three Flashes or Below Threshold", level: "A" },
  "2.4.1": { name: "Bypass Blocks", level: "A" },
  "2.4.2": { name: "Page Titled", level: "A" },
  "2.4.3": { name: "Focus Order", level: "A" },
  "2.4.4": { name: "Link Purpose (In Context)", level: "A" },
  "2.4.5": { name: "Multiple Ways", level: "AA" },
  "2.4.6": { name: "Headings and Labels", level: "AA" },
  "2.4.7": { name: "Focus Visible", level: "AA" },
  "2.4.11": { name: "Focus Not Obscured (Minimum)", level: "AA" },
  "2.5.1": { name: "Pointer Gestures", level: "A" },
  "2.5.2": { name: "Pointer Cancellation", level: "A" },
  "2.5.3": { name: "Label in Name", level: "A" },
  "2.5.4": { name: "Motion Actuation", level: "A" },
  "2.5.7": { name: "Dragging Movements", level: "AA" },
  "2.5.8": { name: "Target Size (Minimum)", level: "AA" },
  "3.1.1": { name: "Language of Page", level: "A" },
  "3.1.2": { name: "Language of Parts", level: "AA" },
  "3.2.1": { name: "On Focus", level: "A" },
  "3.2.2": { name: "On Input", level: "A" },
  "3.2.3": { name: "Consistent Navigation", level: "AA" },
  "3.2.4": { name: "Consistent Identification", level: "AA" },
  "3.2.6": { name: "Consistent Help", level: "A" },
  "3.3.1": { name: "Error Identification", level: "A" },
  "3.3.2": { name: "Labels or Instructions", level: "A" },
  "3.3.3": { name: "Error Suggestion", level: "AA" },
  "3.3.4": { name: "Error Prevention (Legal, Financial, Data)", level: "AA" },
  "3.3.7": { name: "Redundant Entry", level: "A" },
  "3.3.8": { name: "Accessible Authentication (Minimum)", level: "AA" },
  "4.1.1": { name: "Parsing (removed in WCAG 2.2)", level: "A" },
  "4.1.2": { name: "Name, Role, Value", level: "A" },
  "4.1.3": { name: "Status Messages", level: "AA" },
};

/** axe tags selected for a WCAG 2.2 level AA scan. */
export const WCAG22_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** WCAG 2.2 additions at level A or AA, which RGAA 4.1.2 (based on WCAG 2.1) cannot relate to. */
export const NEW_IN_WCAG22 = new Set(["2.4.11", "2.5.7", "2.5.8", "3.2.6", "3.3.7", "3.3.8"]);

/**
 * Level A and AA success criteria named by axe tags, in tag order: `wcag111` → 1.1.1, `wcag1410` → 1.4.10,
 * `wcag2411` → 2.4.11. Principles and guidelines are single digits, so the rest of the tag is the criterion
 * number. Level tags (`wcag2aa`, `wcag21a`) end with a letter and are ignored, and so are criteria outside
 * `CRITERIA`. Bounded whatever the caller passes: the report reads tags from the bundled axe catalog only.
 */
export function criteriaFromTags(tags: readonly unknown[]): string[] {
  const found = new Set<string>();
  for (const tag of tags.slice(0, 200)) {
    const match = typeof tag === "string" ? /^wcag(\d)(\d)(\d{1,2})$/.exec(tag) : null;
    if (!match) continue;
    const sc = `${match[1]}.${match[2]}.${match[3]}`;
    if (Object.hasOwn(CRITERIA, sc)) found.add(sc);
    if (found.size >= 10) break;
  }
  return [...found];
}

export function describeCriterion(sc: string): { sc: string; name: string; level: Level | null } {
  const known = CRITERIA[sc];
  return known ? { sc, ...known } : { sc, name: `WCAG ${sc}`, level: null };
}

/** Sort key for criterion numbers: 1.4.3 before 1.4.10. */
export function compareCriteria(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (pa[index] ?? 0) - (pb[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
