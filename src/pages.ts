// Public pages served by the Worker next to the MCP endpoint: home, documentation (required by the Claude
// directory), privacy policy and terms (required by both directories), and the not-found page. No cookie; one
// inline script (copy buttons), allowed by its hash. Every statement about data must match the code: worker.ts
// logs no URL and no tool argument. Example figures come from real calls of 2026-10-04 (production).
// Design of 2026-10-05: Atkinson Hyperlegible Next and Mono (Braille Institute, OFL), whose 1, l and I differ,
// as a11y and ally must; the WCAG 2.2 AA index of the home page is drawn from the bundled axe catalog.
import { AXE_CATALOG_VERSION, axeRule, axeRuleIds } from "./axe-catalog.ts";
import { BRAND } from "./brand.ts";
import { RESCAN_AFTER_MS } from "./scan-core.ts";
import type { RgaaCriterion, RgaaData } from "./rgaa-index.ts";
import { CRITERIA, NEW_IN_WCAG22, WCAG22_AA_TAGS, compareCriteria, criteriaFromTags, describeCriterion } from "./wcag.ts";

/** Atkinson Hyperlegible Next, variable weight, Latin subset, from @fontsource-variable 5.3.0 (OFL, assets/fonts). */
export const FONT_PATH = "/fonts/atkinson-next-5.3.0.woff2";
/** Atkinson Hyperlegible Mono, same source: connector URL, criterion numbers, code. */
export const MONO_FONT_PATH = "/fonts/atkinson-mono-5.3.0.woff2";
export const FAVICON_PATH = "/favicon.svg";
/** 512×512 PNG of the same logo, for the MCP clients and directories that do not render SVG. */
export const ICON_PATH = "/icon-512.png";

// Copy buttons: each names the element whose text it copies. Any change to this text changes its hash:
// test/pages.test.ts checks it.
export const COPY_SCRIPT = `const s=document.getElementById("copy-status");let n=0;for(const b of document.querySelectorAll("button[data-copy]")){const t=document.getElementById(b.dataset.copy),l=b.textContent;if(!navigator.clipboard||!t){b.hidden=true;continue}b.addEventListener("click",async()=>{const c=++n;let ok=1;try{await navigator.clipboard.writeText(t.textContent.trim());b.textContent="Copied";b.dataset.done="";s.textContent=b.dataset.say}catch{ok=0;b.textContent="Failed";s.textContent="";setTimeout(()=>{if(c==n)s.textContent="Copy failed. Select the text and copy it."},50)}setTimeout(()=>{b.textContent=l;delete b.dataset.done;if(ok&&c==n)s.textContent=""},2500)})}`;
export const COPY_SCRIPT_HASH = "sha256-YYYCZMNxvewFyQPSTUPHlZO+LC6G3DzJiLsrUwzJIiw=";

// The pages use no powerful API; clipboard-write stays allowed for the Copy buttons.
const PERMISSIONS = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), display-capture=(), browsing-topics=()";
const CSP = `default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; script-src '${COPY_SCRIPT_HASH}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

// ── WCAG 2.2 AA index ──────────────────────────────────────────────────────────────────────────────────────
// The 55 level A and AA criteria (4.1.1 left out, removed in 2.2), the ones at least one rule of the bundled
// axe catalog tests, and the failures of Deque's Mars Commuter demo, scanned in production on 2026-10-04
// (same figures as the report table below). The demo is built with deliberate errors; never show a real site's
// failures here.
const PRINCIPLES = ["Perceivable", "Operable", "Understandable", "Robust"];
const DEMO_FAILURES: Record<string, { elements: number; impact: string }> = {
  "1.1.1": { elements: 4, impact: "4 critical" },
  "1.4.1": { elements: 1, impact: "1 serious" },
  "1.4.3": { elements: 6, impact: "6 serious" },
  "2.4.4": { elements: 8, impact: "8 serious" },
  "2.5.8": { elements: 23, impact: "23 serious" },
  "3.1.1": { elements: 1, impact: "1 serious" },
  "4.1.2": { elements: 4, impact: "3 critical, 1 serious" },
};
const AA_CRITERIA = Object.entries(CRITERIA)
  .filter(([sc, criterion]) => criterion.level !== "AAA" && sc !== "4.1.1")
  .map(([sc]) => sc)
  .sort(compareCriteria);
const AUTOMATED = new Set<string>();
for (const id of axeRuleIds()) {
  const rule = axeRule(id);
  if (rule?.tags.some((tag) => WCAG22_AA_TAGS.includes(tag))) for (const sc of criteriaFromTags(rule.tags)) AUTOMATED.add(sc);
}
const COUNTS = {
  total: AA_CRITERIA.length,
  automated: AA_CRITERIA.filter((sc) => AUTOMATED.has(sc)).length,
  failed: Object.keys(DEMO_FAILURES).length,
};
const scId = (sc: string) => `sc-${sc.replaceAll(".", "-")}`;

// Design of 2026-10-06: the index is a ring around the headline, one segment per criterion, a gap between the
// four principles, numbered in the gap before each. Yellow and blue on blue recall the European flag without
// its emblem: the site is not affiliated with the EU.
const RING = { r: 430, gap: 1.1, groupGap: 7 };

function arc(a1: number, a2: number): string {
  const point = (angle: number) => {
    const t = (angle * Math.PI) / 180;
    return `${(500 + RING.r * Math.cos(t)).toFixed(1)} ${(500 + RING.r * Math.sin(t)).toFixed(1)}`;
  };
  return `M${point(a1)}A${RING.r} ${RING.r} 0 0 1 ${point(a2)}`;
}

/** The ring (SVG), its explanation and its legend, placed around the headline by the hero grid. */
function wcagRing(): { ring: string; about: string; key: string } {
  const groups = PRINCIPLES.map((_, index) => AA_CRITERIA.filter((sc) => sc.startsWith(`${index + 1}.`)));
  const span = (360 - groups.length * RING.groupGap - (COUNTS.total - groups.length) * RING.gap) / COUNTS.total;
  let angle = -90 + RING.groupGap / 2;
  const parts: string[] = [];
  groups.forEach((criteria, index) => {
    const label = ((angle - RING.groupGap / 2) * Math.PI) / 180;
    parts.push(`<text class="p" x="${(500 + RING.r * Math.cos(label)).toFixed(1)}" y="${(500 + RING.r * Math.sin(label)).toFixed(1)}">${index + 1}</text>`);
    criteria.forEach((sc, position) => {
      const d = arc(angle, angle + span);
      const failure = DEMO_FAILURES[sc];
      if (failure) {
        parts.push(`<a href="#${scId(sc)}" aria-label="${sc} ${escapeHtml(describeCriterion(sc).name)}: failed, ${failure.impact}"><path class="s fail" d="${d}"/></a>`);
      } else {
        parts.push(`<path class="s ${AUTOMATED.has(sc) ? "auto" : "manual"}" d="${d}"/>`);
      }
      angle += span + (position < criteria.length - 1 ? RING.gap : 0);
    });
    angle += RING.groupGap;
  });
  const readouts = Object.entries(DEMO_FAILURES)
    .map(([sc, failure]) => `<span data-sc="${sc}"><b>${sc}</b> ${escapeHtml(describeCriterion(sc).name)}: ${failure.impact}</span>`)
    .join("");
  // Background of the page: a soft light behind the ring and its echoes, wider and fainter outwards, drawn past
  // the SVG box (overflow visible) so that the field around the ring is never a flat colour.
  const echoes = [540, 650, 780, 930, 1100, 1300, 1530, 1790, 2080, 2400]
    .map((r, index) => `<circle cx="500" cy="500" r="${r}" stroke-opacity="${(0.12 - index * 0.012).toFixed(3)}"/>`)
    .join("");
  const backdrop = `<defs><radialGradient id="glow" class="glow"><stop offset="0" stop-opacity=".7"/><stop offset=".45" stop-opacity=".32"/><stop offset="1" stop-opacity="0"/></radialGradient></defs><g class="echo" aria-hidden="true"><circle cx="500" cy="500" r="1500" style="fill:url(#glow);stroke:none"/>${echoes}</g>`;
  return {
    ring: `<svg class="ring" viewBox="20 20 960 960" role="group" aria-labelledby="ring-title"><title id="ring-title">WCAG 2.2 success criteria failed on a demo page</title>${backdrop}${parts.join("")}</svg>`,
    about: `<p class="about" id="index-title"><strong>${COUNTS.total} success criteria</strong> of WCAG 2.2, levels A and AA, one segment each. Numbers 1 to 4 mark the principles.</p>
<p class="sr-only">On a demo page, ${COUNTS.failed} failed, ${COUNTS.automated - COUNTS.failed} have an automated rule and no failure, ${COUNTS.total - COUNTS.automated} have no automated rule and need a person.</p>`,
    key: `<ul class="legend" role="list"><li><i class="fail"></i>Failed on a demo page: ${COUNTS.failed}</li><li><i class="auto"></i>Automated rule, no failure: ${COUNTS.automated - COUNTS.failed}</li><li><i class="manual"></i>No automated rule, a person checks: ${COUNTS.total - COUNTS.automated}</li></ul>
<p class="ro" aria-hidden="true"><span class="ro-default">Point at a yellow segment to see what failed.</span><span class="ro-touch">Tap a yellow segment to see its row in the report.</span>${readouts}</p>
<p class="src-demo"><a href="https://dequeuniversity.com/demo/mars/">Mars Commuter</a>, a demo page by Deque with deliberate errors, scanned on 4 October 2026 with axe-core ${escapeHtml(AXE_CATALOG_VERSION)}.</p>`,
  };
}

// Readout of the ring: the line of the legend names the failure the pointer or focus is on.
const READOUT_STYLE = Object.keys(DEMO_FAILURES)
  .map((sc) => `.hero:has(a[href="#${scId(sc)}"]:is(:hover,:focus-visible)) .ro [data-sc="${sc}"]`)
  .join(",");

const STYLE = `@font-face{font-family:"Atkinson Next";src:url(${FONT_PATH}) format("woff2");font-weight:200 800;font-display:swap}
@font-face{font-family:"Atkinson Mono";src:url(${MONO_FONT_PATH}) format("woff2");font-weight:200 800;font-display:swap}
:root{color-scheme:light dark;--sans:"Atkinson Next",system-ui,"Segoe UI",sans-serif;--mono:"Atkinson Mono",ui-monospace,Consolas,monospace;--blue:#003399;--deep:#00206b;--yellow:#ffcc00;--mist:#c7d3f5;--peri:#9bb2f2;--navy:#0a1238;--bg:#003399;--ink:#fff;--soft:#c7d3f5;--rule:rgba(199,211,245,.26);--code:rgba(255,255,255,.13);--link:#fff;--accent:#ffcc00;--crit:#a3231a;--focus:#ffcc00;--mark:#fff0a8;--field:linear-gradient(180deg,#0b3fb5 0,#003399 900px,#002f8f 2200px,#00266f 100%);--low:rgba(31,86,214,.35);--end:#00266f;--glow:#1f56d6;--ease-out:cubic-bezier(.23,1,.32,1)}
@media (prefers-color-scheme:dark){:root{--bg:#061a55;--field:linear-gradient(180deg,#0a2878 0,#061a55 900px,#04123c 2200px,#020a26 100%);--low:rgba(29,75,192,.3);--end:#020a26;--glow:#1d4bc0}}
.sheet,.answer{--ink:#0a1238;--soft:#3d4a7a;--rule:#d3dbf0;--code:#e6ebf8;--link:#003399;--accent:#003399;--crit:#a3231a;--focus:#003399;--mark:#fff0a8;background:#fff;color:var(--ink);border-radius:2px;box-shadow:0 1px 0 rgba(0,10,50,.18),0 22px 30px -26px rgba(0,10,50,.6)}
@media (prefers-color-scheme:dark){.sheet,.answer{--ink:#e9edfb;--soft:#b8c3e6;--rule:#2a3a78;--code:#1c2853;--link:#ffd84d;--accent:#ffcc00;--crit:#ff9c94;--focus:#ffcc00;--mark:#4a3f00;background:#0f2058;box-shadow:0 0 0 1px rgba(155,178,242,.18),0 12px 32px rgba(0,0,0,.35)}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;background:var(--end)}
body{margin:0;background:radial-gradient(90% 50% at 50% 100%,var(--low),transparent 70%),var(--field);color:var(--ink);font:400 1.125rem/1.6 var(--sans);display:flex;flex-direction:column;min-height:100vh;overflow-x:clip}main{flex:1 0 auto}
a{color:var(--link);text-underline-offset:.18em;text-decoration-thickness:.07em}
:focus-visible{outline:3px solid var(--focus);outline-offset:3px}
code{font-family:var(--mono);font-size:.88em;background:var(--code);padding:.08em .35em;border-radius:3px;overflow-wrap:anywhere}
.sr-only{position:absolute;width:1px;height:1px;margin:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.skip{position:absolute;left:-999px;top:12px;background:var(--yellow);color:var(--navy);padding:8px 14px;font-weight:700;z-index:2}.skip:focus{left:16px}
.wrap{--gutter:56px;max-width:1280px;margin:0 auto;padding-inline:var(--gutter)}
.blue{color:#fff}
h1,h2,h3{font-weight:800;margin:0;overflow-wrap:break-word;text-wrap:balance}
h1{line-height:1;letter-spacing:-.028em}
h2{font-size:clamp(2rem,1.3rem + 2vw,3.1rem);line-height:1.04;letter-spacing:-.024em}
h3{font-size:1.3rem;line-height:1.25;letter-spacing:-.01em}
.site{view-transition-name:site-header}
.bar{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:4px 32px;padding-block:16px}
.brand{font-weight:800;font-size:1.45rem;letter-spacing:-.02em;color:#fff;text-decoration:none;padding:6px 0}.brand span{color:var(--yellow)}
.bar nav{display:flex;flex-wrap:wrap;gap:0 28px;font-size:1rem}
.bar nav a{color:#fff;text-decoration:none;padding:10px 0;border-bottom:3px solid transparent}
.bar nav a:hover{border-color:var(--mist)}.bar nav a[aria-current=page]{border-color:var(--yellow)}
.hero{--d:min(500px,max(300px,calc(100svh - 400px)),calc(100vw - 32px));display:grid;grid-template-columns:minmax(0,1fr) var(--d) minmax(0,1fr);grid-template-areas:"about ring key" "cta cta cta";column-gap:56px;align-items:center;padding-block:4px 64px}
.hero h1{grid-area:ring;justify-self:center;width:calc(var(--d) * .74);font-size:calc(var(--d) * .078);line-height:1.06;letter-spacing:-.025em;text-align:center;text-wrap:balance}
.ring{grid-area:ring;display:block;width:var(--d);height:var(--d);overflow:visible}.hero>:not(.ring){position:relative;z-index:1}
.ring .echo{pointer-events:none}.ring .echo circle{fill:none;stroke:var(--mist);vector-effect:non-scaling-stroke;stroke-width:1}.ring .glow stop{stop-color:var(--glow)}
.ring .s{fill:none;stroke-linecap:butt}
.ring .auto{stroke:var(--peri);stroke-width:40}
.ring .manual{stroke:var(--mist);stroke-width:12}
.ring .fail{stroke:var(--yellow);stroke-width:76}
.ring a{outline:none}.ring a:is(:hover,:focus-visible) .fail{stroke:#fff;stroke-width:112}
.ring .p{fill:var(--mist);font:700 34px var(--mono);text-anchor:middle;dominant-baseline:central}
.about{grid-area:about;justify-self:end;max-width:22ch;margin:0;text-align:right;font-size:1rem;line-height:1.5;color:var(--mist)}.about strong{display:block;color:#fff;font-size:1.6rem;line-height:1.15;letter-spacing:-.02em;margin-bottom:6px}
.hero .key{grid-area:key;max-width:30ch}
.cta{grid-area:cta;justify-self:center;display:flex;flex-direction:column;align-items:center;text-align:center;max-width:46rem;margin-top:20px}
.lead{font-size:clamp(1.125rem,1rem + .4vw,1.3rem);line-height:1.5;color:#fff;max-width:44ch;margin:0 0 20px;text-wrap:balance}
.label{font-weight:700;font-size:.95rem;margin:0 0 8px}
.url{display:flex;width:fit-content;max-width:100%;background:var(--yellow);color:var(--navy);border-radius:3px}
.url code{background:none;color:inherit;border-radius:0;font:600 1.15rem/1.25 var(--mono);padding:17px 20px}
.url button{border:0;border-left:2px solid var(--navy);background:transparent;color:var(--navy);font:800 1.05rem var(--sans);padding:0 22px;min-width:6.4em;cursor:pointer;border-radius:0 3px 3px 0;transition:background-color .15s ease}
.url button:hover{background:#ffdb4d}.url button[data-done]{background:#fff}.url button:focus-visible{outline:3px solid var(--navy);outline-offset:-7px}
.how{font-size:.95rem;line-height:1.5;color:var(--mist);margin:14px 0 0;max-width:52ch;text-wrap:balance}
.legend{display:grid;gap:10px;margin:0;padding:0;list-style:none;font-size:.95rem;line-height:1.35;color:#fff}
.legend li{text-wrap:pretty;display:grid;grid-template-columns:28px minmax(0,1fr);align-items:center;gap:12px}.legend i{height:14px;border-radius:1px}
.legend .fail{background:var(--yellow);height:20px}.legend .auto{background:var(--peri)}.legend .manual{height:4px;background:var(--mist)}
.ro{text-wrap:pretty;min-height:3em;margin:18px 0 0;font-size:.95rem;line-height:1.45;color:#fff}.ro [data-sc],.ro .ro-touch{display:none}.ro b{font-family:var(--mono);color:var(--yellow);margin-right:6px}
.hero:has(.ring a:is(:hover,:focus-visible)) .ro-default{display:none}${READOUT_STYLE}{display:inline}
@media (hover:none){.ro .ro-default{display:none}.ro .ro-touch{display:inline}}
.src-demo{font-size:.85rem;line-height:1.5;color:var(--mist);margin:14px 0 0;padding-top:14px;border-top:1px solid rgba(199,211,245,.28)}
.section{padding-block:clamp(56px,7vw,104px)}.section+.section{padding-top:clamp(40px,5vw,72px)}
.intro{font-size:1.2rem;color:var(--soft);max-width:54ch;margin:18px 0 0}
.checks{list-style:none;margin:56px 0 0;padding:0;display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:clamp(40px,5vw,80px);align-items:start}
.check{border-top:6px solid var(--yellow);padding-top:24px}
.step-text h3{font-size:clamp(1.5rem,1.2rem + .8vw,2rem);line-height:1.12;letter-spacing:-.02em;margin:8px 0 12px}
.step-text p{margin:0 0 1em;max-width:52ch}.tool{font-size:.95rem;margin:0}.tool code{font-size:.95rem}
.step-text+.answer{margin-top:20px}
.note{color:var(--soft);font-size:.95rem;max-width:72ch}
.answer{margin:0;padding:clamp(24px,3vw,40px)}
.ask{margin:0 0 18px;font-size:1.2rem;line-height:1.45;color:var(--soft);max-width:44ch}
.verdict{font-weight:800;font-size:clamp(2.8rem,2rem + 2.6vw,4.2rem);line-height:1;letter-spacing:-.035em;margin:0 0 26px;color:var(--accent)}
.reasons{margin:0}.reasons div{display:grid;grid-template-columns:9.5rem minmax(0,1fr);gap:4px 20px;padding:14px 0;border-top:1px solid var(--rule)}
.reasons dt{font:600 .95rem/1.55 var(--mono)}.reasons dd{margin:0;font-size:1.02rem;line-height:1.55}
.src{font-size:.875rem;line-height:1.5;max-width:72ch;color:var(--soft);margin-top:18px}
.report .meta{margin:0 0 4px;color:var(--soft);font-size:.95rem;max-width:72ch}.report .meta strong{display:block;color:var(--ink);font-size:1.35rem;letter-spacing:-.01em}
.sum{display:flex;flex-wrap:wrap;gap:8px 36px;margin:18px 0 6px;padding:16px 0;border-block:1px solid var(--rule)}
.sum div{display:flex;flex-direction:column-reverse}.sum dt{font-size:.9rem;color:var(--soft)}.sum dd{margin:0;font-weight:800;font-size:2.2rem;line-height:1.05;letter-spacing:-.03em}
table{width:100%;border-collapse:collapse;font-size:1rem;line-height:1.4}
th{font-size:.85rem;font-weight:600;color:var(--soft);text-align:left;padding:10px 8px 6px}
td{padding:13px 8px;border-bottom:1px solid var(--rule);vertical-align:baseline}
th:first-child,td:first-child{padding-left:0}th:last-child,td:last-child{padding-right:0;text-align:right}
tr{scroll-margin-top:24px}
.sc-n{font:700 1.05rem var(--mono);color:var(--accent);white-space:nowrap}
td small{display:block;color:var(--soft);font-size:.85rem;margin-top:2px}.n{white-space:nowrap}.crit{color:var(--crit);font-weight:700}
td code{display:inline-block;margin-top:8px;font-size:.8rem}
tr:target td{background:var(--mark)}
.install{padding-top:0}
.install-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px 64px;align-items:end}
.install-head p{margin:14px 0 0;color:var(--soft);max-width:44ch}
.assistants{max-width:48rem;margin-top:48px}
.assistant{border-top:1px solid var(--rule);padding-top:22px;margin-top:28px}
.pick{display:inline-flex;flex-wrap:wrap;align-items:center;gap:0;margin:0;padding:0;border:0}
.pick legend{float:left;margin-right:16px;font-weight:700;font-size:1rem}@media (max-width:420px){.pick legend{float:none;display:block;margin:0 0 8px}}
.pick input{position:absolute;opacity:0;width:1px;height:1px;margin:0}
.pick label{padding:10px 22px;font-weight:700;font-size:1.05rem;border:2px solid var(--yellow);cursor:pointer;color:#fff;transition:background-color .15s ease,color .15s ease}
.pick label:first-of-type{border-radius:4px 0 0 4px}.pick label:last-of-type{border-radius:0 4px 4px 0;border-left:0}
.pick label:hover{background:rgba(255,204,0,.16)}
.pick input:checked+label{background:var(--yellow);color:#0a1238}
.pick input:focus-visible+label{outline:3px solid #fff;outline-offset:3px}
.assistants:has(#pick-claude:checked) #steps-chatgpt,.assistants:has(#pick-chatgpt:checked) #steps-claude{display:none}
.assistant h3{font-size:1.7rem;letter-spacing:-.02em;margin:0 0 6px}
.assistant h3+.note{margin:0 0 22px}
.steps{margin:0;padding:0;list-style:none;counter-reset:s}
.steps li{counter-increment:s;display:grid;grid-template-columns:2.25rem minmax(0,1fr);gap:4px 14px;padding:0 0 20px}
.steps li::before{content:counter(s);content:counter(s) / "";display:grid;place-items:center;width:2.25rem;height:2.25rem;background:var(--yellow);color:#0a1238;font:700 1rem/1 var(--mono);border-radius:3px;margin-top:-.1em}
.ask-h{margin:64px 0 18px;font-size:1.7rem;letter-spacing:-.02em}
.prompts{margin:0;padding:0;list-style:none;display:grid;gap:10px}
.prompts li{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;border-top:1px solid var(--rule)}
.prompts p{text-wrap:pretty;margin:0;font-size:1.05rem;max-width:68ch}.prompts p::before{content:"“";content:"“" / ""}.prompts p::after{content:"”";content:"”" / ""}
.prompts button{flex:none;border:1.5px solid var(--ink);background:transparent;color:var(--ink);font:700 .95rem var(--sans);padding:8px 16px;min-width:5.6em;border-radius:3px;cursor:pointer;transition:background-color .15s ease,color .15s ease}
.prompts button:hover,.prompts button[data-done]{background:#fff;color:#0a1238}
.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:clamp(40px,6vw,96px)}
.facts h2{font-size:clamp(1.8rem,1.3rem + 1.4vw,2.5rem);margin-bottom:22px}
.facts ul{margin:0;padding-left:1.2em}.facts li{margin:0 0 .75em}.facts p{color:var(--soft);font-size:1rem;margin:20px 0 0}
.head{padding-block:40px 64px}.head h1{font-size:clamp(2.5rem,1.4rem + 3.6vw,4.6rem)}.head p{color:var(--mist);margin:20px 0 0;max-width:60ch;font-size:1.15rem}
.prose{max-width:46rem;margin-block:8px 88px;padding:clamp(24px,4vw,56px)}.prose h2{font-size:clamp(1.6rem,1.3rem + 1vw,2.15rem);margin:2.2em 0 .6em}.prose h2:first-child{margin-top:0}.prose h3{margin:1.8em 0 .5em}.prose li{margin:.35em 0}
.prose .steps{margin-top:16px}
.docs{display:grid;grid-template-columns:minmax(0,46rem) 13rem;gap:80px;align-items:start}
.toc{order:2;position:sticky;top:24px;margin-top:64px;border-left:4px solid var(--yellow);padding:4px 0 4px 18px}.toc p{margin:0 0 6px;font-weight:700;font-size:.95rem}
.toc ul{margin:0;padding:0;list-style:none;font-size:.95rem}.toc li{margin:0}.toc a{display:inline-block;padding:4px 0}
.dated{color:var(--soft)}
.map{margin-block:8px 88px;padding:clamp(24px,4vw,56px)}.map h2{font-size:clamp(1.6rem,1.3rem + 1vw,2.15rem);margin:2em 0 .5em}.map h2:first-child{margin-top:0}.map>p{max-width:62ch;overflow-wrap:anywhere}
.map table{margin-top:12px}.map th[scope=row]{width:36%;font-size:1rem;font-weight:400;color:var(--ink);padding:13px 16px 13px 0;border-bottom:1px solid var(--rule);vertical-align:baseline}.map th[scope=row] small{display:block;color:var(--soft);font-size:.85rem;margin-top:2px}.map td{text-align:left}
.map ul{margin:0;padding:0;list-style:none}.map td li{margin:0 0 .5em}.map td li:last-child{margin:0}.map .rid{font:700 1rem var(--mono);color:var(--accent);margin-right:6px}.none{color:var(--soft)}
@media (max-width:600px){.map th[scope=row]{width:42%}}
.lost{margin-block:8px 96px;padding:clamp(24px,4vw,48px);max-width:46rem}.lost ul{padding-left:1.2em}
footer{color:var(--mist);font-size:.95rem}footer .wrap{background:linear-gradient(var(--rule),var(--rule)) top center/calc(100% - 2*var(--gutter)) 1px no-repeat;display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px 40px;padding-block:32px}footer p{margin:0 0 4px}footer a{color:#fff}footer nav{display:flex;gap:0 22px;flex-wrap:wrap}
@media (forced-colors:active){.pick input:checked+label{forced-color-adjust:none;background:Highlight;color:HighlightText}.ring .auto,.ring .manual{stroke:CanvasText}.ring .fail{stroke:Highlight}.ring a:is(:hover,:focus-visible) .fail{stroke:LinkText}.ring .p{fill:CanvasText}.legend i{background:CanvasText}.legend .fail{background:Highlight}.bar nav a[aria-current=page]{text-decoration:underline}code{border:1px solid CanvasText}}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}
@view-transition{navigation:auto}
::view-transition-old(root),::view-transition-new(root){animation-duration:.22s}
.ring .fail{transition:stroke .15s ease,stroke-width .15s var(--ease-out)}
tr:target td{animation:mark 2s ease-out both}}
@keyframes mark{0%,40%{background:var(--mark)}100%{background:transparent}}
@media (max-width:1100px){.docs{display:block}.toc{position:static;margin-top:32px}.toc ul{display:flex;flex-wrap:wrap;gap:0 20px}}
@media (max-width:1080px){.hero{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-areas:"ring ring" "cta cta" "about key";row-gap:0;column-gap:40px}.ring,.hero h1{justify-self:center}.about{justify-self:start;text-align:left;max-width:34ch;margin-top:48px;align-self:start}.hero .key{margin-top:48px;align-self:start}}
@media (max-width:980px){.wrap{--gutter:24px}.checks{grid-template-columns:1fr}.install-head{grid-template-columns:1fr}.facts{grid-template-columns:1fr}}
@media (max-width:600px){.wrap{--gutter:16px}.bar{padding-block:10px}.bar nav{gap:0 18px;font-size:.95rem}.hero{grid-template-columns:minmax(0,1fr);grid-template-areas:"ring" "cta" "about" "key";padding-block:4px 48px}.cta{margin-top:20px}.about{margin-top:40px}.hero .key{margin-top:28px;max-width:none}.head h1{font-size:min(10vw,2.7rem)}.reasons div{grid-template-columns:1fr}.section{padding-block:52px}.prompts li{flex-direction:column;align-items:stretch}.prompts button{align-self:flex-start}.sum{gap:8px 24px}.sum dd{font-size:1.7rem}}
@media (max-width:380px){.bar{column-gap:12px}.brand{font-size:1.2rem}.bar nav{gap:0 12px;font-size:.875rem}}
@media (max-width:340px){.brand{font-size:1.1rem}.bar nav{gap:0 10px;font-size:.8125rem}}
@media (max-width:420px){.url{flex-direction:column;width:100%}.url code{font-size:1.05rem;padding:14px 16px}.url button{border-left:0;border-top:2px solid var(--navy);padding:12px;border-radius:0 0 3px 3px}}`;

type Path = "/" | "/docs" | "/privacy" | "/terms" | "/rgaa-wcag";

// Search and sharing metadata. The canonical address is the public site, whatever host served the page. The not-found
// page (current null) has no canonical and asks not to be indexed. One language, so no hreflang.
const absolute = (path: string) => `${BRAND.site}${path}`;

/** Structured data of the home page: the free web application. No rating, no review. */
function homeJsonLd(description: string): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: BRAND.name,
    url: absolute("/"),
    description,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    inLanguage: "en",
    image: absolute(ICON_PATH),
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    featureList: ["scan_page: automated WCAG 2.2 AA accessibility scan of one public web page", "check_eaa_scope: European Accessibility Act scope check for a business"],
    publisher: { "@type": "Person", name: BRAND.publisher },
  };
  // "<" escaped so that no value can close the script element.
  return `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`;
}

function seoHead(title: string, description: string, current: Path | null): string {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const url = current === null ? "" : escapeHtml(absolute(current));
  const share = current === null ? "" : `<link rel="canonical" href="${url}"><meta property="og:type" content="website"><meta property="og:site_name" content="${escapeHtml(BRAND.name)}"><meta property="og:title" content="${t}"><meta property="og:description" content="${d}"><meta property="og:url" content="${url}"><meta property="og:image" content="${escapeHtml(absolute(ICON_PATH))}"><meta name="twitter:card" content="summary">`;
  return `<title>${t}</title><meta name="description" content="${d}">${current === null ? '<meta name="robots" content="noindex">' : share}${current === "/" ? homeJsonLd(description) : ""}`;
}

function layout(title: string, description: string, current: Path | null, body: string, status = 200): Response {
  const link = (href: Path, label: string) => `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${label}</a>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${seoHead(title, description, current)}
<meta name="theme-color" content="#003399"><link rel="icon" href="${FAVICON_PATH}" type="image/svg+xml">
<link rel="preload" href="${FONT_PATH}" as="font" type="font/woff2" crossorigin><link rel="preload" href="${MONO_FONT_PATH}" as="font" type="font/woff2" crossorigin><style>${STYLE}</style></head>
<body><a class="skip" href="#main">Skip to content</a>
<header class="blue site"><div class="wrap bar"><a class="brand" href="/"${current === "/" ? ' aria-current="page"' : ""}>EuroA<span>11</span>y</a><nav aria-label="Site">${link("/docs", "Documentation")}${link("/privacy", "Privacy")}${link("/terms", "Terms")}</nav></div></header>
<main id="main">${body}</main>
<footer><div class="wrap"><div><p>Independent service, not affiliated with the European Union or any EU institution.</p><p>Published by ${escapeHtml(BRAND.publisher)}, ${escapeHtml(BRAND.country)}. Contact: <a href="mailto:${BRAND.contactEmail}">${BRAND.contactEmail}</a></p></div><nav aria-label="Footer"><a href="/docs">Documentation</a><a href="/rgaa-wcag">RGAA and WCAG</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav></div></footer>
<p class="sr-only" role="status" id="copy-status"></p><script>${COPY_SCRIPT}</script></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": status === 200 ? "public, max-age=3600" : "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "permissions-policy": PERMISSIONS, "cross-origin-opener-policy": "same-origin", "content-security-policy": CSP } });
}

/** "2026-10-04" as "4 October 2026", the date format of the pages. */
function longDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Connector URL with its copy button; `id` keeps each copy on a page distinct. */
function connectorUrl(mcpUrl: string, id: string, labelled = true): string {
  return `${labelled ? `<p class="label" id="${id}-label">Connector URL (remote MCP server)</p>` : ""}<div class="url" role="group" ${labelled ? `aria-labelledby="${id}-label"` : 'aria-label="Connector URL"'}><code id="${id}">${escapeHtml(mcpUrl)}</code><button type="button" data-copy="${id}" data-say="Connector URL copied.">Copy</button></div>`;
}

// Install steps of the home page and /docs, one list per assistant. Checked on STEPS_CHECKED: Claude on
// support.claude.com/en/articles/11175166 (Customize, Connectors; Free plan limited to one custom connector),
// ChatGPT on developers.openai.com/api/docs/guides/developer-mode (plans, web only; Security and login;
// Plugins; Developer mode in the + menu) and developers.openai.com/plugins/deploy/connect-chatgpt (account and
// workspace policy). The Connect step comes from the ChatGPT trial of 2026-10-03 (README).
const STEPS_CHECKED = "2026-10-05";
const CLAUDE_STEPS = `<h3 id="in-claude">In Claude</h3>
<p class="note">On claude.ai or the Claude desktop app. The Free plan allows one custom connector.</p>
<ol class="steps" role="list"><li><span>Open <a href="https://claude.ai/customize/connectors">Customize, then Connectors</a>. Select <strong>+ Add</strong>, then <strong>Add custom connector</strong>.</span></li>
<li><span>Name it ${escapeHtml(BRAND.name)}, paste the connector URL and select <strong>Continue</strong>. Choose <strong>No sign in</strong>, select <strong>Continue</strong>, then <strong>Add</strong>.</span></li>
<li><span>In a conversation, open the <strong>+</strong> menu at the bottom left, then <strong>Connectors</strong>, and turn ${escapeHtml(BRAND.name)} on.</span></li></ol>
<p class="note">Team or Enterprise plan: an owner first adds ${escapeHtml(BRAND.name)} in <a href="https://claude.ai/admin-settings/connectors">Organization settings, then Connectors</a>. Each member then finds it in Customize, then Connectors, and selects <strong>Connect</strong>.</p>`;
const CHATGPT_STEPS = `<h3 id="in-chatgpt">In ChatGPT</h3>
<p class="note">On the web, with a Plus, Pro, Business, Enterprise or Education account. Availability can depend on your account and workspace policy.</p>
<ol class="steps" role="list"><li><span>Open <strong>Settings</strong>, then <strong>Security and login</strong>, and turn on <strong>Developer mode</strong>.</span></li>
<li><span>Open <strong>Plugins</strong> and select the <strong>+</strong> button. Enter ${escapeHtml(BRAND.name)} as the name, a short description and the connector URL, with no authentication, then create it.</span></li>
<li><span>On the ${escapeHtml(BRAND.name)} plugin page, select <strong>Connect</strong> and add it to ChatGPT. Without this step, ChatGPT answers without ${escapeHtml(BRAND.name)}.</span></li>
<li><span>In a conversation, open the <strong>+</strong> menu, choose <strong>Developer mode</strong> and select ${escapeHtml(BRAND.name)}.</span></li></ol>`;
const NAME_IT = `If the assistant answers without ${escapeHtml(BRAND.name)}, name it in your request.`;

function pageHead(title: string, intro: string): string {
  return `<div class="blue"><div class="wrap head"><h1>${title}</h1><p>${intro}</p></div></div>`;
}

const NOT_COMPLIANCE = `<li>Automated tools detect only part of accessibility issues. A scan with no failure does not mean the page is accessible or compliant; a conformance claim or an accessibility statement needs a manual audit.</li>`;
// Home page: the three limits a first visitor needs; /docs keeps the full list.
const HOME_LIMITS = `${NOT_COMPLIANCE}
<li>One public page per call, with no login. Pages behind bot protection may refuse the scan: see <a href="/docs#blocked">when a site blocks the scanner</a>.</li>
<li>Fair-use limits keep the service free: for each ChatGPT account or network address, one scan at a time and 40 a day.</li>`;
const LIMITS = `${NOT_COMPLIANCE}
<li>One page per call, main document only (no iframe), no login, no form submission.</li>
<li>Private, local and reserved addresses are refused for the page and its redirects; the resources it loads are checked by host name.</li>
<li>Fair-use limits keep the service free:<ul>
<li>for each ChatGPT account, or each network address for a client on your own computer: one scan at a time, 40 scans a day (a reused result does not count) and 10 calls a minute in each Cloudflare location;</li>
<li>for each scanned site: 2 scans at a time and 30 an hour, so that the service never weighs on a site;</li>
<li>for all users together: 8 scans at a time and a daily scanning time, with a share kept for ChatGPT, for Claude on the web and for the other clients. Claude on the web sends no user identifier: its users share the platform's share, and each of its server addresses can send 30 calls a minute in each Cloudflare location. The same applies to ChatGPT calls that carry no account identifier.</li></ul>
Daily counts start again at midnight UTC. When a limit is reached, the error message says which one and when to try again.</li>
<li>A page scanned again with the same options within 24 hours may get the earlier result. The report says so first and gives the time of that scan; <code>fresh</code> scans the page again once that result is ${RESCAN_AFTER_MS / 60_000} minutes old.</li>`;

const PROMPTS = [
  `With ${BRAND.name}, check the accessibility of https://www.example.com/cart on mobile.`,
  `With ${BRAND.name}, which RGAA criteria does my home page fail? https://example.fr`,
  `I run an online shop with 12 employees and €1.5M turnover. With ${BRAND.name}: does the EAA apply to me?`,
];

/** Meta description of the home page: what it is, for whom, the two checks; the same facts as the lead above. */
export const HOME_DESCRIPTION = `Free MCP server for ChatGPT and Claude. It checks whether the European Accessibility Act applies to a business and scans a web page against WCAG 2.2 AA.`;

// Proof shown on the home page: answer of check_eaa_scope (sector e_commerce, 12 employees, EUR 1.5 million
// turnover) and scan_page report of Deque's Mars Commuter demo, both called in production on 2026-10-04.
// The demo is built with deliberate errors; never show a real site's failures here.
export function homePage(mcpUrl: string): Response {
  const row = (sc: string, failure: string, detail: string, elements: string, code = "") =>
    `<tr id="${scId(sc)}"><td class="sc-n">${sc}</td><td>${failure}<small>${detail.replace(/ (AA?)$/, "&nbsp;$1")}</small>${code}</td><td class="n">${elements}</td></tr>`;
  const index = wcagRing();
  return layout(`${BRAND.name}: accessibility and EAA checks in ChatGPT and Claude`, HOME_DESCRIPTION, "/",`<div class="blue"><div class="wrap hero">
<h1>Does the European Accessibility Act apply to your business?</h1>
<div class="cta"><p class="lead">Ask ChatGPT or Claude. ${escapeHtml(BRAND.name)} tells whether the EAA applies to the business, then scans the page against WCAG 2.2 AA and lists what to fix. Free, no account.</p>
${connectorUrl(mcpUrl, "mcp-url")}
<p class="how">Paste it as a connector into Claude, Free plan included, or into ChatGPT on the web with a Plus, Pro, Business, Enterprise or Education account. <a href="#connect">How to add it</a></p></div>
${index.ring}
${index.about}
<div class="key">${index.key}</div>
</div></div>
<section class="section" aria-labelledby="answers"><div class="wrap">
<h2 id="answers">Two checks, inside the conversation</h2>
<p class="intro">Ask in plain language: the assistant decides when to call ${escapeHtml(BRAND.name)} and answers from its result.</p>
<ol class="checks" role="list">
<li class="check"><div class="step-text"><p class="tool"><code>check_eaa_scope</code></p><h3>Does the EAA apply to the business?</h3>
<p>It applies the scope rules of Directive (EU) 2019/882 to the service, headcount and turnover you give, including the exemption for microenterprises.</p><p class="note">No network access, nothing stored.</p></div>
<figure class="answer"><p class="ask">“I run an online shop with 12 employees and €1.5M turnover. Does the EAA apply to me?”</p>
<p class="verdict">In scope.</p>
<dl class="reasons"><div><dt>Article 2(2)</dt><dd>E-commerce services provided to EU consumers are listed in the EAA.</dd></div>
<div><dt>12 employees</dt><dd>Not a microenterprise (fewer than 10 persons), so the exemption does not apply.</dd></div>
<div><dt>28 June 2025</dt><dd>The requirements apply to services provided to consumers from that date.</dd></div></dl>
<figcaption class="src">Answer of check_eaa_scope on 4 October 2026, shortened. Information, not legal advice.</figcaption></figure></li>
<li class="check"><div class="step-text"><p class="tool"><code>scan_page</code></p><h3>What fails on the page?</h3>
<p>Give the assistant a page address. It gets the failures grouped by WCAG success criterion, most severe first, with the failing elements and how to fix them. Options: mobile viewport, RGAA 4.1.2 criteria (the French framework), best-practice rules.</p>
<p class="note">The scan loads one public page in a headless browser and runs <a href="https://github.com/dequelabs/axe-core">axe-core</a> against WCAG 2.2 level AA. axe-core finds on average 57% of WCAG issues, according to its documentation. Keyboard use, screen readers and content quality need manual testing.</p></div>
<figure class="answer report"><p class="meta"><strong>Mars Commuter</strong>A <a href="https://dequeuniversity.com/demo/mars/">demo page by Deque</a> with deliberate errors, scanned on 4 October 2026. 30 rules passed, 3 need a review by hand.</p>
<dl class="sum"><div><dt>failed rules</dt><dd>9</dd></div><div><dt>failing elements</dt><dd>47</dd></div><div><dt>critical elements</dt><dd>7</dd></div></dl>
<table><caption class="sr-only">Failures of the Mars Commuter page by WCAG success criterion</caption>
<thead><tr><th scope="col">WCAG</th><th scope="col">Failure</th><th scope="col">Elements</th></tr></thead><tbody>
${row("1.1.1", "Images without alternative text", "Non-text Content, level A", '<span class="crit">4 critical</span>', '<code>&lt;img src="…/mars-spaceman.jpg" width="210" height="120"&gt;</code>')}
${row("4.1.2", "Selects, a button and a frame without an accessible name", "Name, Role, Value, level A", '<span class="crit">3 critical</span><br>1 serious')}
${row("1.4.1", "Link told apart from its text by colour only", "Use of Color, level A", "1 serious")}
${row("1.4.3", "Text contrast below 4.5:1 (3:1 for large text)", "Contrast (Minimum), level AA", "6 serious")}
${row("2.4.4", "Links without discernible text", "Link Purpose (In Context), level A", "8 serious")}
${row("2.5.8", "Touch targets smaller than 24 by 24 px", "Target Size (Minimum), level AA", "23 serious")}
${row("3.1.1", "Page language not declared", "Language of Page, level A", "1 serious")}
</tbody></table></figure></li>
</ol></div></section>
<section class="section install" aria-labelledby="connect"><div class="wrap">
<div class="install-head"><div><h2 id="connect">Add ${escapeHtml(BRAND.name)} to Claude or ChatGPT</h2><p>Do it once, in the assistant you use, with this connector URL. Then ask in plain language.</p></div>
<div>${connectorUrl(mcpUrl, "mcp-url-2", false)}</div></div>
<div class="assistants"><fieldset class="pick"><legend>Your assistant</legend><input type="radio" name="assistant" id="pick-claude" checked><label for="pick-claude">Claude</label><input type="radio" name="assistant" id="pick-chatgpt"><label for="pick-chatgpt">ChatGPT</label></fieldset>
<div class="assistant" id="steps-claude">${CLAUDE_STEPS}</div><div class="assistant" id="steps-chatgpt">${CHATGPT_STEPS}</div></div>
<h3 class="ask-h" id="ask">Then ask</h3>
<ul class="prompts" role="list">${PROMPTS.map((prompt, index) => `<li><p id="prompt-${index + 1}">${escapeHtml(prompt)}</p><button type="button" data-copy="prompt-${index + 1}" data-say="Prompt copied." aria-label="Copy prompt ${index + 1}">Copy</button></li>`).join("")}</ul>
<p class="note">${NAME_IT}</p>
</div></section>
<section class="section" aria-label="Limits and data"><div class="wrap facts">
<div><h2 id="limits-title">Limits</h2><ul>${HOME_LIMITS}</ul><p>Other limits, such as refused private addresses and reused results, are in the <a href="/docs#limits">documentation</a>. Questions or a wrong result: <a href="mailto:${BRAND.contactEmail}">${BRAND.contactEmail}</a></p></div>
<div><h2 id="data-title">Your data</h2><ul><li>No account, no cookie, no tracking. The service sees only the tool arguments your assistant sends, never your conversation.</li>
<li>Both tools are read-only: nothing is submitted to the scanned page.</li>
<li>The raw result of a scan, which includes the page address, is kept up to 24 hours, encrypted, to answer the same request again.</li>
<li>Logs hold no page address and no argument.</li></ul><p>Details in the <a href="/privacy">privacy policy</a>.</p></div>
</div></section>`);
}

// Public documentation required by the Claude directory. Parameters, verdicts and messages must match
// src/mcp/server.ts, src/eaa.ts and src/scan-core.ts.
export function docsPage(mcpUrl: string): Response {
  return layout(`Documentation | ${BRAND.name}`, `How to add ${BRAND.name} to Claude or ChatGPT, the parameters of scan_page and check_eaa_scope, their verdicts and the usage limits.`, "/docs",`${pageHead("Documentation", `${escapeHtml(BRAND.name)} is a remote MCP server with two read-only tools: an automated accessibility scan of one public web page, and a check of the European Accessibility Act (EAA) scope for a business. Free, no account, no authentication.`)}
<div class="wrap docs"><nav class="toc" aria-labelledby="toc-title"><p id="toc-title">On this page</p><ul><li><a href="#connect">Connect</a></li><li><a href="#examples">Example prompts</a></li><li><a href="#scan-page">scan_page</a></li><li><a href="#check-eaa-scope">check_eaa_scope</a></li><li><a href="#limits">Limits</a></li><li><a href="#blocked">Blocked scans</a></li><li><a href="#data">Data</a></li><li><a href="#support">Support</a></li></ul></nav>
<div class="prose sheet"><h2 id="connect">Connect</h2>
<p>Connector URL, a remote MCP server (Streamable HTTP) with no authentication:</p>
${connectorUrl(mcpUrl, "mcp-url", false)}
${CLAUDE_STEPS}
${CHATGPT_STEPS}
<p class="dated">Steps checked on ${longDate(STEPS_CHECKED)} against the Claude and OpenAI help pages.</p>
<h2 id="examples">Example prompts</h2>
<ul><li>“With ${escapeHtml(BRAND.name)}, check the accessibility of https://www.gov.uk on mobile.”</li>
<li>“With ${escapeHtml(BRAND.name)}, which RGAA criteria does my home page fail? https://example.fr”</li>
<li>“I run an online shop with 6 employees and €1.2 million turnover. With ${escapeHtml(BRAND.name)}: does the European Accessibility Act apply to me?”</li></ul>
<p>Ask in plain language: the assistant decides when to call a tool. ${NAME_IT}</p>
<h2 id="scan-page">scan_page</h2>
<p>Loads one public page in a headless Chromium browser, runs <a href="https://github.com/dequelabs/axe-core">axe-core</a> against WCAG 2.2 level AA, and returns the failures grouped by WCAG success criterion, most severe first. A scan usually takes 5 to 30 seconds.</p>
<h3>Parameters</h3>
<ul><li><code>url</code> (required): the page address. A bare domain such as <code>example.com</code> is read as https://.</li>
<li><code>viewport</code>: <code>desktop</code> (1280×800, default) or <code>mobile</code> (390×844).</li>
<li><code>include_rgaa</code>: add the related criteria of RGAA 4.1.2, the French accessibility framework, to each WCAG criterion. RGAA 4.1.2 follows WCAG 2.1, so criteria new in WCAG 2.2 have no RGAA match. <a href="/rgaa-wcag">See the full table</a>.</li>
<li><code>include_best_practices</code>: also run axe best-practice rules, which are not WCAG requirements.</li>
<li><code>max_examples</code>: failing elements shown per rule, 1 to 5 (2 by default).</li>
<li><code>fresh</code>: scan the page again instead of reusing a recent result, for example after fixing it. Accepted once the earlier scan is ${RESCAN_AFTER_MS / 60_000} minutes old.</li></ul>
<h3>Result</h3>
<ul><li>Summary: failed rules, failing elements by impact (critical, serious, moderate, minor), passed rules, rules to review.</li>
<li>For each failed WCAG criterion: its level, the axe rules that failed, their impact, the number of elements, examples (CSS selector and HTML excerpt) and how to fix them.</li>
<li>Checks that need manual review: axe could not decide, a person must look.</li>
<li>The EAA rule in short, and the limits of the scan.</li>
<li>When the result comes from a recent scan of the same page, a first line says so, with the time of that scan.</li></ul>
<p>Of the ${COUNTS.total} success criteria of WCAG 2.2 at levels A and AA, axe-core ${escapeHtml(AXE_CATALOG_VERSION)} has at least one rule for ${COUNTS.automated}. The other ${COUNTS.total - COUNTS.automated} need a person.</p>
<h3>When there is no report</h3>
<p>The tool returns an error message instead of a misleading report when the page cannot be scanned: private, local or reserved address; port other than 80 or 443; unknown domain; HTTP status 400 or above; a bot-protection page (for example Cloudflare, DataDome or Akamai); a page that does not load in time; or one of the <a href="#limits">limits</a> reached, in which case the message says when to try again.</p>
<h2 id="check-eaa-scope">check_eaa_scope</h2>
<p>Applies the scope rules of <a href="https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng">Directive (EU) 2019/882</a>, applicable since 28 June 2025, to the figures given. No network access, nothing stored.</p>
<h3>Parameters</h3>
<ul><li><code>sector</code> (required): the consumer service to check. For a business offering several of them, the assistant calls the tool once per service.
<ul><li><code>e_commerce</code>: consumers can conclude a contract through the website or app (order, book, subscribe), whatever the trade.</li>
<li><code>consumer_banking</code>, <code>e_books</code>, <code>audiovisual_media_access</code>.</li>
<li><code>electronic_communications</code>, except transmission services for machine-to-machine services.</li>
<li><code>passenger_transport</code>: air, bus and coach, rail and waterborne transport, other than urban, suburban and regional services.</li>
<li><code>urban_regional_transport</code>: urban, suburban and regional transport.</li>
<li><code>other</code>: none of these.</li></ul></li>
<li><code>sells_to_eu_consumers</code> (required): true if the service is offered to consumers in the EU, not only to businesses.</li>
<li><code>public_body</code>: true for a ministry, local authority or public institution.</li>
<li><code>employees</code>, <code>annual_turnover_eur</code>, <code>balance_sheet_eur</code>: used for the microenterprise exemption, which needs fewer than 10 persons and an annual turnover or balance sheet total not above EUR 2 million. Figures from the latest approved accounts, turnover excluding VAT, partner and linked enterprises included (Recommendation 2003/361/EC).</li></ul>
<h3>Verdicts</h3>
<ul><li><code>in_scope</code>: the accessibility requirements for services apply.</li>
<li><code>terminals_only</code>: for urban, suburban and regional transport, the EAA covers only the interactive self-service terminals, not the website or the app. A website or app selling tickets to consumers is checked again as <code>e_commerce</code>.</li>
<li><code>exempt_microenterprise</code>: microenterprise providing services, exempt from the requirements for services.</li>
<li><code>out_of_scope</code>: the service is not one the directive lists, or it is not offered to EU consumers. The EAA also covers answering emergency calls to 112, and products (computers, smartphones, self-service terminals, e-readers…), which have their own requirements: neither is assessed here.</li>
<li><code>public_sector_other_law</code>: a public body whose service the EAA does not list falls under Directive (EU) 2016/2102 (in France, the RGAA). A public body providing a listed service gets <code>in_scope</code>: both directives apply, and the microenterprise exemption does not.</li>
<li><code>need_more_info</code>: a figure is missing; the assistant should ask for it.</li></ul>
<p>Each verdict comes with its reasons, key dates and legal sources, such as EUR-Lex and Légifrance. It is information, not legal advice.</p>
<h2 id="limits">Limits</h2>
<ul>${LIMITS}</ul>
<h2 id="blocked">When a site blocks the scanner</h2>
<p>Many shops put their pages behind a bot protection service such as DataDome, Cloudflare or Akamai. ${escapeHtml(BRAND.name)} opens pages in a cloud browser, which these services treat as a bot: the scan then stops with a message naming the service, and gives no report rather than a report on the challenge page.</p>
<ul><li><strong>If you run the site:</strong> in your bot protection settings, add a rule that lets through requests whose user agent contains <code>${BRAND.slug}/</code>. Anyone can send that user agent, so limit the rule to the pages you want to check, and remove it afterwards.</li>
<li><strong>Otherwise:</strong> test the page in your own browser with a tool such as axe DevTools.</li></ul>
<h2 id="data">Data</h2>
<p>Tool arguments are processed in memory. The raw result of a scan, which includes the page address, is kept up to 24 hours, encrypted, to answer the same request again. Logs hold no page address and no argument. The usage limits count the scans of each client and site under hashes whose key changes every day. Details in the <a href="/privacy">privacy policy</a>.</p>
<h2 id="support">Support</h2>
<p>Questions, a wrong result or a page that should scan: <a href="mailto:${BRAND.contactEmail}">${BRAND.contactEmail}</a></p>
</div></div>`);
}

/**
 * /rgaa-wcag (audit n° 29): the level A and AA criteria of WCAG 2.2 against the criteria of RGAA 4.1.2 that data/rgaa-4.1.2-wcag.json
 * relates to them. Built from that file, which the Worker bundles and the tests read; no figure typed here.
 * "Related", never "equivalent": the page claims no legal equivalence and no conformance.
 */
export function rgaaWcagPage(data: RgaaData): Response {
  const bySc = new Map<string, RgaaCriterion[]>();
  for (const criterion of data.criteria) for (const sc of criterion.wcag) bySc.set(sc, [...(bySc.get(sc) ?? []), criterion]);
  const related = AA_CRITERIA.filter((sc) => bySc.has(sc)).length;
  const rgaaTotal = data.criteria.length;
  const newInTwo = AA_CRITERIA.filter((sc) => NEW_IN_WCAG22.has(sc));
  const cell = (sc: string) => {
    const list = bySc.get(sc);
    if (!list) return `<span class="none">${NEW_IN_WCAG22.has(sc) ? "None: new in WCAG 2.2, after the WCAG 2.1 that RGAA 4.1.2 follows." : "None in the data."}</span>`;
    return `<ul role="list">${list.map((criterion) => `<li><span class="rid">${escapeHtml(criterion.id)}</span><span lang="fr">${escapeHtml(criterion.title)}</span></li>`).join("")}</ul>`;
  };
  const tables = PRINCIPLES.map((principle, index) => {
    const rows = AA_CRITERIA.filter((sc) => sc.startsWith(`${index + 1}.`))
      .map((sc) => {
        const { name, level } = describeCriterion(sc);
        return `<tr id="${scId(sc)}"><th scope="row"><span class="sc-n">${sc}</span> ${escapeHtml(name)}<small>Level ${level}</small></th><td>${cell(sc)}</td></tr>`;
      })
      .join("");
    return `<h2 id="p${index + 1}">${index + 1}. ${principle}</h2>
<table aria-labelledby="p${index + 1}"><thead><tr><th scope="col">WCAG 2.2 success criterion</th><th scope="col">Related RGAA 4.1.2 criteria</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join("\n");
  return layout(
    `RGAA 4.1.2 and WCAG 2.2 criteria | ${BRAND.name}`,
    `Which RGAA 4.1.2 criteria relate to each WCAG 2.2 level A and AA success criterion. The link is "related", not "equivalent".`,
    "/rgaa-wcag",
    `${pageHead("RGAA 4.1.2 and WCAG 2.2: related criteria", `RGAA is the French accessibility framework. This table lists, for each WCAG 2.2 success criterion at level A or AA, the RGAA 4.1.2 criteria related to it.`)}
<div class="wrap"><div class="map sheet">
<h2 id="read">How to read it</h2>
<p>The link is <strong>related</strong>, not <strong>equivalent</strong>. One WCAG criterion maps to several RGAA criteria, and each RGAA criterion has its own tests, which can be stricter or narrower than the WCAG criterion. Passing one side does not show that the other is met.</p>
<p>${related} of the ${AA_CRITERIA.length} level A and AA criteria of WCAG 2.2 have at least one related criterion among the ${rgaaTotal} of RGAA 4.1.2. The ${newInTwo.length} criteria added in WCAG 2.2 (${newInTwo.join(", ")}) have none, because RGAA 4.1.2 follows WCAG 2.1. Criterion 4.1.1, removed in WCAG 2.2, is left out.</p>
<p>This page gives information. It is not legal advice, states no legal equivalence between the two frameworks and says nothing about the conformance of any site. RGAA criterion titles are in French, their original language.</p>
${tables}
<h2 id="source">Source</h2>
<p class="src">RGAA 4.1.2 criteria and their WCAG references: <a href="${escapeHtml(data.source)}">${escapeHtml(data.source)}</a> (DISIC, French government), file read on ${longDate(data.read_on ?? "")}. WCAG 2.2 criterion names and levels: <a href="https://www.w3.org/TR/WCAG22/">W3C Recommendation</a>. The <code>include_rgaa</code> option of <code>scan_page</code> uses this same data: see the <a href="/docs#scan-page">documentation</a>.</p>
</div></div>`,
  );
}

// Each statement must match the code and the Cloudflare set-up, as read on 2026-10-05: Worker log lines hold
// the MCP method and tool name only (src/worker/index.ts), the raw result stays 24 h encrypted in the cache
// of the data centre (src/worker/scan-cache.ts), Workers Logs keep 7 days on Workers Paid, the Cloudflare DPA
// (version 6.4) relies on the Data Privacy Framework and the standard contractual clauses, and Cloudflare
// drops the client address of a network error report once processed (developers.cloudflare.com/network-error-logging).
// Usage limits (src/worker/ledger.ts, src/worker/index.ts): HMAC under a key drawn each UTC day, deleted with the
// counts at midnight; the storage of SQLite-backed Durable Objects can be restored to any point of the past
// 30 days (developers.cloudflare.com/durable-objects/api/sqlite-storage-api, read on 2026-10-05); the rate
// limiter gets an unkeyed SHA-256 hash and counts per Cloudflare location; `openai/subject` is described by OpenAI as an anonymised user id for rate
// limiting (developers.openai.com/apps-sdk/reference, read on 2026-10-05).
export function privacyPage(updated: string): Response {
  const contact = `<a href="mailto:${BRAND.contactEmail}">${BRAND.contactEmail}</a>`;
  return layout(`Privacy policy | ${BRAND.name}`, `What ${BRAND.name} receives, why, how long it is kept and who processes it. No account, no cookie, no tracking.`, "/privacy",`${pageHead("Privacy policy", `No account, no cookie, no tracking. The service sees only the tool arguments your assistant sends, never your conversation.`)}
<div class="wrap"><div class="prose sheet">
<p class="dated">Last updated: ${escapeHtml(longDate(updated))}</p>
<p>${escapeHtml(BRAND.name)} is published by ${escapeHtml(BRAND.publisher)} (${escapeHtml(BRAND.country)}), who is the data controller for the processing described here. Contact: ${contact}</p>
<h2>What the service receives</h2>
<ul><li>The arguments of each tool call, sent by the AI assistant you use: for the page scan, the page address and the options; for the EAA check, the service category, whether you sell to EU consumers, and the headcount, turnover or balance sheet figures you chose to give.</li>
<li>Technical request data: the network address of the client that calls the server, and standard HTTP headers. With ChatGPT or Claude on the web, that client is the AI platform's servers; with a client on your own computer, such as Claude Code or a code editor, it is your own address.</li>
<li>With ChatGPT, an anonymised identifier of your ChatGPT account, which OpenAI sends to the tools it calls for rate limiting.</li></ul>
<h2>What it does with them</h2>
<ul><li>The page is loaded in a browser, as a visitor would see it, to run the accessibility check. Nothing is submitted to it.</li>
<li>To run the check, that browser downloads the axe-core program from euroa11y.com itself, not from a third-party network.</li>
<li>The report returned to the assistant contains the page title, its final address, and short HTML excerpts of the failing elements. If the page itself shows personal data, an excerpt may contain it.</li>
<li>The EAA check only applies rules to the figures given: it opens no page and stores nothing.</li></ul>
<h2>Purposes, legal basis and retention</h2>
<p>Each processing relies on the publisher's legitimate interest (GDPR article 6(1)(f)), stated below.</p>
<ul><li><strong>Answering tool calls.</strong> Tool arguments and the page loaded for the check, to provide the check you asked your assistant to run. Processed in memory during the call.</li>
<li><strong>Reusing a recent result.</strong> The raw result of a scan, which includes the page address, its title and the HTML excerpts, to answer the same request again without a new scan, which limits cost and delay. Kept up to 24 hours in the cache of the Cloudflare data centre that ran the scan. It is stored under a hash of the request and encrypted with a key derived from the page address and options: it can be read only by a request for the same page, and it is linked to no one.</li>
<li><strong>Running and securing the service.</strong> Logs of the time, MCP method, tool name, response status and duration, and, when a limit refuses a scan, of that limit and the kind of client (ChatGPT, Claude or other), to find faults and detect abuse. They contain no page address, no identifier, no tool argument and no report. Cloudflare keeps them for 7 days.</li>
<li><strong>Usage statistics.</strong> For each call: the MCP method and tool name (from a fixed list), the kind of client (ChatGPT, Claude, a direct client such as one on your own computer, or other), whether the call succeeded, failed or hit a limit, how a scan ended (new result, reused result, bot protection, limit or error) and durations, to measure use and size the service. They contain no network address, no page address or domain, no identifier, no hash and no tool argument. Cloudflare keeps them for 3 months (Workers Analytics Engine).</li>
<li><strong>Usage limits.</strong> To share the service fairly and keep it free, the scans of each client and of each scanned site are counted: the client is the ChatGPT account identifier or, for a client on your own computer, its network address; the site is its domain name. Both are stored only as keyed hashes (HMAC-SHA-256), under a random key drawn each day. At midnight UTC the key and the counts are deleted. Cloudflare keeps a recovery history of this storage for 30 days: until then, a restored copy holds that day's key, which could link the hashes back to the client and to the sites it was scanning. Cloudflare's rate limiter also receives an unkeyed hash of the client, to count its calls of the last minute in each Cloudflare location. The total browser time per day is counted with no identifier.</li>
<li><strong>Visits to this site.</strong> Your network address and request headers, processed by Cloudflare to deliver the pages and protect the site; the server logs no page visit. If a page fails to load, your browser may send Cloudflare a network error report, from which Cloudflare removes your network address once processed.</li>
<li><strong>Messages to ${BRAND.contactEmail}.</strong> Your address and message, to answer you. They are forwarded to the publisher's mailbox and kept as long as the exchange requires.</li></ul>
<p>Giving data is not required by law or contract. A page scan needs a page address, and the EAA check needs the figures it asks for: without them, the tool gives no result. No decision with legal or similarly significant effects is made about you by automated means.</p>
<h2>Who processes data</h2>
<ul><li>Cloudflare, Inc., as a processor: it hosts the server and this site, runs the scanning browser (Browser Run), resolves domain names (1.1.1.1), holds the cache, the logs and the usage statistics, and forwards email (Email Routing).</li>
<li>The provider of the publisher's mailbox, as a processor, for messages.</li>
<li>The AI platform that called the tool, such as OpenAI or Anthropic, receives the result and handles it under its own privacy policy.</li></ul>
<p>No data is sold, shared for advertising, or used to train models.</p>
<h2>Transfers outside the EU</h2>
<p>Cloudflare may process data in the United States and other countries. These transfers follow <a href="https://www.cloudflare.com/cloudflare-customer-dpa/">Cloudflare's data processing addendum</a>, which relies on the EU-U.S. Data Privacy Framework and the European Commission's standard contractual clauses. A copy is available on request at the contact address.</p>
<h2>Your rights</h2>
<p>Under the GDPR you may ask for access, rectification, erasure, restriction or objection by writing to ${contact}. Cached results are linked to no one, usage counts are deleted every day and tool arguments are kept nowhere else, so there is usually nothing to return. You may also complain to the CNIL (<a href="https://www.cnil.fr/">cnil.fr</a>).</p>
<p>Do not put personal data in a page address you ask the assistant to scan.</p>
<h2>Changes</h2>
<p>Changes to this policy are published on this page with a new date.</p>
</div></div>`);
}

export function termsPage(updated: string): Response {
  return layout(`Terms of use | ${BRAND.name}`, `Terms of use of ${BRAND.name}, a free informational service: its results are not an audit, a certificate or legal advice.`, "/terms",`${pageHead("Terms of use", `${escapeHtml(BRAND.name)} is free and informational. Its results are not an audit, a certificate or legal advice.`)}
<div class="wrap"><div class="prose sheet">
<p class="dated">Last updated: ${escapeHtml(longDate(updated))}</p>
<h2>The service</h2>
<p>${escapeHtml(BRAND.name)} is a free service published by ${escapeHtml(BRAND.publisher)} (${escapeHtml(BRAND.country)}). It gives AI assistants two tools: an automated accessibility scan of one public web page, and a check of the European Accessibility Act scope for a business. Its limits, such as one page per call and a number of scans per user and per day, are listed in the <a href="/docs#limits">documentation</a>. It is provided as is, without warranty, and may change, be limited or stop at any time.</p>
<h2>Results</h2>
<p>Results come from automated checks and from a simplified reading of Directive (EU) 2019/882. They are informational, not a conformance certificate, an audit or legal advice.</p>
<h2>Your use</h2>
<p>Only scan pages you are entitled to visit. Do not use the service to overload or probe a site, or to get around its limits: a client that does may be limited or blocked.</p>
<h2>Liability</h2>
<p>To the extent permitted by law, the publisher is not liable for decisions taken on the basis of the results.</p>
<h2>Licences</h2>
<p>The scan runs <a href="https://github.com/dequelabs/axe-core">axe-core</a> by Deque Systems, under the Mozilla Public License 2.0. This site uses the Atkinson Hyperlegible Next and Atkinson Hyperlegible Mono typefaces, under the SIL Open Font License 1.1.</p>
<h2>Law and contact</h2>
<p>These terms are governed by French law. If you use the service as a consumer, you keep the protection of the mandatory rules of the country where you live. Changes to these terms are published on this page with a new date. Questions: <a href="mailto:${BRAND.contactEmail}">${BRAND.contactEmail}</a>. See also the <a href="/privacy">privacy policy</a>.</p>
</div></div>`);
}

/** Any other address of the site, for GET and HEAD. */
export function notFoundPage(): Response {
  return layout(`Page not found | ${BRAND.name}`, `This address does not match any page of ${BRAND.name}.`, null,`${pageHead("Page not found", "This address does not match any page of the site. It may be mistyped.")}
<div class="wrap"><div class="lost sheet"><p>These pages exist:</p><ul><li><a href="/">Home</a>: what ${escapeHtml(BRAND.name)} does and how to add it to Claude or ChatGPT</li><li><a href="/docs">Documentation</a>: tools, parameters and limits</li><li><a href="/privacy">Privacy policy</a></li><li><a href="/terms">Terms of use</a></li></ul></div></div>`, 404);
}
