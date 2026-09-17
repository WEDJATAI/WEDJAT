// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT Task 30 — Trade knowledge corpus builder: HS Nomenclature.
//
// Compiles db/trade-corpus/hs/harmonized-system.csv (UN Comtrade HS
// classification, PDDL, via github.com/datasets/harmonized-system) into
// per-chapter markdown reference documents + one overview document, in
// db/trade-corpus/hs/docs/ — ready for scripts/ingest-trade-knowledge.ts.
//
// Usage: bun scripts/build-hs-chapters.ts [--src csv] [--out dir]
// ═══════════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const SRC = arg('src') ?? 'scripts/trade-corpus/hs/harmonized-system.csv';
const OUT = arg('out') ?? 'scripts/trade-corpus/hs/docs';

// ── CSV parsing (RFC-4180 subset: quoted fields, embedded commas/quotes) ─────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // drop empty trailing rows
  return rows.filter((r) => r.some((f) => f.trim().length > 0));
}

interface HsRow {
  section: string;
  hscode: string;
  description: string;
  parent: string;
  level: string; // '2' | '4' | '6' (dataset also has one '5' anomaly)
}

const raw = parseCsv(readFileSync(SRC, 'utf8'));
const header = raw[0];
const rows: HsRow[] = raw.slice(1).map((r) => ({
  section: r[0]?.trim() ?? '',
  hscode: r[1]?.trim() ?? '',
  description: (r[2] ?? '').trim(),
  parent: r[3]?.trim() ?? '',
  level: (r[4] ?? '').trim(),
}));

const anomalies = rows.filter((r) => !['2', '4', '6'].includes(r.level));
const chapters = rows.filter((r) => r.level === '2');
const headings = rows.filter((r) => r.level === '4');
const subheadings = rows.filter((r) => r.level === '6');
console.log(`parsed ${rows.length} rows → ${chapters.length} chapters, ${headings.length} headings, ${subheadings.length} subheadings (${anomalies.length} anomalies)`);

mkdirSync(OUT, { recursive: true });

// ── Chapter docs ─────────────────────────────────────────────────────────────
const slugify = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const chapterTitle = new Map<string, string>(); // code → description
for (const c of chapters) chapterTitle.set(c.hscode, c.description);

// group 4/6-level rows per chapter (first 2 digits)
const byChapter = new Map<string, HsRow[]>();
for (const r of [...headings, ...subheadings, ...anomalies]) {
  const key = r.hscode.slice(0, 2);
  if (!byChapter.has(key)) byChapter.set(key, []);
  byChapter.get(key)!.push(r);
}

const ROMAN = new Map(chapters.map((c) => [c.hscode, c.section]));
let written = 0;
// API title limit is 200 chars — cap chapter doc titles (ch 24/34/86/94 exceed)
const capTitle = (code: string, desc: string): string => {
  const full = `HS Chapter ${code} — ${desc}`;
  if (full.length <= 190) return full;
  return `HS Chapter ${code} — ${desc.slice(0, 170).replace(/[,;: ]+\S*$/, '')}…`;
};
for (const c of chapters) {
  const code = c.hscode;
  const kids = (byChapter.get(code) ?? []).sort((a, b) => a.hscode.localeCompare(b.hscode));
  const section = c.section;
  const title = c.description.replace(/;$/, '');
  const lines: string[] = [];
  lines.push('---');
  lines.push(`title: "${capTitle(code, title).replace(/"/g, '')}"`);
  lines.push('docType: REFERENCE');
  lines.push('domain: hs');
  lines.push('category: chapter');
  lines.push('jurisdiction: GLOBAL');
  lines.push(`chapter: "${code}"`);
  lines.push(`section: "${section}"`);
  lines.push('sources:');
  lines.push('  - https://github.com/datasets/harmonized-system');
  lines.push('  - https://comtrade.un.org/data/doc/api/');
  lines.push('---');
  lines.push('');
  lines.push(`# HS Chapter ${code} — ${title}`);
  lines.push('');
  lines.push(`Harmonized System **chapter ${code}** (Section ${section}) of the universal 6-digit tariff nomenclature. This chapter contains ${headings.filter((h) => h.hscode.startsWith(code)).length} four-digit headings and ${subheadings.filter((h) => h.hscode.startsWith(code)).length} six-digit subheadings.`);
  lines.push('');
  lines.push('Codes are universal up to 6 digits (WCO Harmonized System); countries extend them to 8–10 digits in national tariff schedules (e.g., US HTS, EU TARIC, Egyptian tariff).');
  lines.push('');
  lines.push('## Headings and subheadings');
  lines.push('');
  lines.push('| HS code | Level | Description |');
  lines.push('| --- | --- | --- |');
  for (const k of kids) {
    const lvl = k.level === '4' ? 'Heading' : k.level === '6' ? 'Subheading' : `Level ${k.level}`;
    lines.push(`| ${k.hscode} | ${lvl} | ${k.description.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  lines.push(`Provenance: UN Comtrade HS classification (dataset: \`datasets/harmonized-system\`, PDDL open license). Verify live classifications against the current WCO HS edition before customs declaration.`);
  writeFileSync(join(OUT, `chapter-${code}-${slugify(title)}.md`), lines.join('\n') + '\n');
  written++;
}

// ── Overview doc ─────────────────────────────────────────────────────────────
const sectionList = [...new Set(chapters.map((c) => c.section))];
const overview: string[] = [];
overview.push('---');
overview.push('title: "HS Nomenclature Overview — Structure, Sections, and How Tariff Codes Work"');
overview.push('docType: SPEC');
overview.push('domain: hs');
overview.push('category: overview');
overview.push('jurisdiction: GLOBAL');
overview.push('sources:');
overview.push('  - https://github.com/datasets/harmonized-system');
overview.push('  - https://comtrade.un.org/data/doc/api/');
overview.push('  - http://www.wcoomd.org/en/topics/nomenclature/instrument-and-tools.aspx');
overview.push('---');
overview.push('');
overview.push('# HS Nomenclature Overview — Structure, Sections, and How Tariff Codes Work');
overview.push('');
overview.push('## What the Harmonized System is');
overview.push('');
overview.push('The Harmonized Commodity Description and Coding System (HS) is an internationally standardized system of names and numbers to classify traded products, maintained by the World Customs Organization (WCO). It is the foundation of customs tariff schedules, trade statistics, rules-of-origin determination, freight classification, and duty assessment in more than 200 economies.');
overview.push('');
overview.push('## Code structure');
overview.push('');
overview.push('- **First 2 digits — chapter** (96 chapters plus special chapters): the broad product family, e.g. `09` = coffee, tea, maté and spices.');
overview.push('- **Digits 3–4 — heading**: the product group within the chapter, e.g. `0901` = coffee, whether or not roasted or decaffeinated.');
overview.push('- **Digits 5–6 — subheading**: the specific product, e.g. `090111` = coffee, not roasted, not decaffeinated.');
overview.push('- **Digits 7–10 (national)**: countries extend the universal code for national tariff lines and statistical detail — e.g. the US HTS 10-digit, the EU TARIC 8-digit CN + 10-digit TARIC, the Egyptian tariff schedule, Chinese 8–10 digit codes. Only the first 6 digits are guaranteed internationally comparable.');
overview.push('');
overview.push('## The 22 sections');
overview.push('');
overview.push('| Section | Chapters (this dataset) |');
overview.push('| --- | --- |');
for (const s of sectionList) {
  const chs = chapters.filter((c) => c.section === s).map((c) => c.hscode).join(', ');
  overview.push(`| ${s} | ${chs} |`);
}
overview.push('');
overview.push('## Dataset contents and provenance');
overview.push('');
overview.push(`This reference set contains ${chapters.length} chapter records, ${headings.length} four-digit headings, and ${subheadings.length} six-digit subheadings — ${rows.length} rows total — from the UN Comtrade HS classification, republished as the open \u0060datasets/harmonized-system\u0060 dataset under the ODC PDDL public-domain license. One anomalous level-5 record exists in the source data (${anomalies.map((a) => a.hscode).join(', ') || 'none'}) and is preserved where it appears.`);
overview.push('');
overview.push('## Using HS codes in trade operations');
overview.push('');
overview.push('1. Classify the product to the 6-digit universal code (chapter → heading → subheading) using the chapter references in this corpus.');
overview.push('2. Append the national digits from the destination country\'s tariff schedule ( customs authority portal) to obtain the full import tariff line.');
overview.push('3. Check classification opinions and explanatory notes where the product is novel or borderline; WCO publishes classification rulings.');
overview.push('4. The HS is revised periodically (HS 2002, 2007, 2012, 2017, 2022); verify the current edition and any correlation tables for goods classified under older editions.');
overview.push('');
overview.push('## Chapter index');
overview.push('');
overview.push('| Chapter | Title |');
overview.push('| --- | --- |');
for (const c of chapters) overview.push(`| ${c.hscode} | ${c.description.replace(/\|/g, '\\|')} |`);
writeFileSync(join(OUT, 'overview-hs-nomenclature.md'), overview.join('\n') + '\n');

console.log(`wrote ${written} chapter docs + 1 overview → ${OUT}`);
if (!existsSync(join(OUT, 'overview-hs-nomenclature.md'))) throw new Error('overview missing');
