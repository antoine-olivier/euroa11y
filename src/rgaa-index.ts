// RGAA 4.1.2 index built from the criteria data, without any file access: shared by the Node loader
// (`rgaa.ts`) and the Workers build, which imports the JSON directly. The link is "related", not
// "equivalent": one WCAG criterion maps to several RGAA criteria, each with its own tests.

export interface RgaaCriterion {
  id: string;
  topic: string;
  title: string;
  wcag: string[];
}

export interface RgaaData {
  source: string;
  version: string;
  criteria: RgaaCriterion[];
}

export interface RgaaIndex {
  source: string;
  version: string;
  /** RGAA criteria related to a WCAG criterion; with `topics`, only those of these RGAA topics. */
  criteriaFor(sc: string, topics?: readonly string[]): Array<{ id: string; title: string }>;
  /** One criterion by its number (`11.9`); undefined when RGAA 4.1.2 has none. */
  criterion(id: string): { id: string; title: string } | undefined;
}

// RGAA topics of an axe rule, from its `cat.*` tag: the fallback for rules axe does not tag with RGAA tests.
// One WCAG criterion relates to criteria of several topics (4.1.2: images, frames, scripts, forms…); the
// rule's category keeps the ones it can concern.
const TOPICS_BY_CATEGORY: Record<string, string[]> = {
  "cat.text-alternatives": ["Images", "Cadres", "Multimédia"],
  "cat.color": ["Couleurs"],
  "cat.forms": ["Formulaires"],
  "cat.keyboard": ["Navigation", "Scripts"],
  "cat.name-role-value": ["Scripts", "Formulaires", "Liens", "Cadres"],
  "cat.structure": ["Structuration de l'information", "Présentation de l'information"],
  "cat.semantics": ["Structuration de l'information", "Éléments obligatoires"],
  "cat.tables": ["Tableaux"],
  "cat.aria": ["Scripts"],
  "cat.language": ["Éléments obligatoires"],
  "cat.parsing": ["Éléments obligatoires"],
  "cat.sensory-and-visual-cues": ["Présentation de l'information", "Couleurs"],
  "cat.time-and-media": ["Multimédia", "Consultation"],
};

// Untagged rules whose category is broader than what they test: `<summary>` has no RGAA criterion of its own.
const TOPICS_BY_RULE: Record<string, string[]> = {
  "summary-name": [],
};

/** RGAA topics an axe rule can concern; empty when its tags say nothing. */
export function rgaaTopicsForRule(rule: string, tags: readonly string[]): string[] {
  return Object.hasOwn(TOPICS_BY_RULE, rule) ? (TOPICS_BY_RULE[rule] ?? []) : [...new Set(tags.flatMap((tag) => (Object.hasOwn(TOPICS_BY_CATEGORY, tag) ? (TOPICS_BY_CATEGORY[tag] ?? []) : [])))];
}

/** RGAA criteria axe itself ties to a rule: `RGAA-11.9.1`, a test of criterion 11.9, gives 11.9. */
export function nativeRgaa(tags: readonly string[]): string[] {
  return [...new Set(tags.flatMap((tag) => /^RGAA-(\d+\.\d+)\.\d+$/.exec(tag)?.[1] ?? []))];
}

/**
 * RGAA criteria of one axe rule: the ones axe tags it with (axe-core 4.13 tags most WCAG rules with RGAA
 * tests), else those of its WCAG criteria within its topics. Empty when no relation is known.
 */
export function rgaaForRule(index: RgaaIndex, rule: string, tags: readonly string[], wcag: readonly string[]): Array<{ id: string; title: string }> {
  const native = nativeRgaa(tags).flatMap((id) => index.criterion(id) ?? []);
  if (native.length) return native;
  const topics = rgaaTopicsForRule(rule, tags);
  const found = new Map<string, { id: string; title: string }>();
  for (const sc of wcag) for (const criterion of index.criteriaFor(sc, topics)) found.set(criterion.id, criterion);
  return [...found.values()];
}

export function buildRgaaIndex(data: RgaaData): RgaaIndex {
  const bySc = new Map<string, RgaaCriterion[]>();
  const byId = new Map<string, { id: string; title: string }>();
  for (const criterion of data.criteria) {
    byId.set(criterion.id, { id: criterion.id, title: criterion.title });
    for (const sc of criterion.wcag) {
      const list = bySc.get(sc) ?? [];
      list.push(criterion);
      bySc.set(sc, list);
    }
  }
  return {
    source: data.source,
    version: data.version,
    criteriaFor: (sc, topics) => (bySc.get(sc) ?? []).filter((criterion) => !topics || topics.includes(criterion.topic)).map(({ id, title }) => ({ id, title })),
    criterion: (id) => byId.get(id),
  };
}
