// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Quality scoring (§8 QUALITY SCORING) + sensitive-data checks
// (§32) + document classification heuristics (§8 DOCUMENT CLASSIFICATION).
// ═══════════════════════════════════════════════════════════════════════════════

export interface QualityScore {
  score: number; // 0..100
  reasons: string[];
}

/**
 * Heuristic quality score for a text unit. Below-threshold chunks are excluded
 * from retrieval — junk in, junk out is a RAG quality failure mode.
 */
export function scoreTextQuality(text: string): QualityScore {
  const reasons: string[] = [];
  let score = 50;

  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  if (wordCount < 8) {
    score -= 30;
    reasons.push('very short');
  } else if (wordCount < 20) {
    score -= 10;
    reasons.push('short');
  }

  // Unique word ratio — repeated boilerplate scores low.
  const unique = new Set(words.map((w) => w.toLowerCase())).size;
  const ratio = wordCount > 0 ? unique / wordCount : 0;
  if (ratio < 0.35) {
    score -= 25;
    reasons.push('low lexical diversity');
  } else if (ratio > 0.7) {
    score += 15;
    reasons.push('high lexical diversity');
  }

  // Density of domain-signal tokens (specifics beat vagueness).
  const signal = (text.match(/\b(?:must|shall|requires?|provides?|uses?|deploys?|stores?|implements?|endpoint|database|service|API|queue|cache|auth|encrypt|latency|throughput|SLA|SLO|failover|backup|replica|version|risk|blocker|decision|ADR)\b/gi) ?? []).length;
  const density = wordCount > 0 ? signal / wordCount : 0;
  if (density > 0.06) {
    score += 20;
    reasons.push('high domain-signal density');
  } else if (density < 0.01) {
    score -= 10;
    reasons.push('low domain-signal density');
  }

  // Raw gibberish/numeric noise check.
  const alpha = (text.match(/[a-zA-Z]/g) ?? []).length;
  if (text.length > 0 && alpha / text.length < 0.5) {
    score -= 20;
    reasons.push('low alphabetic ratio');
  }

  // Markdown structure signals.
  if (/^[-*]\s|^\d+\.\s|`\w+`|\*\*/m.test(text)) {
    score += 8;
    reasons.push('structured formatting');
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

/**
 * Sensitive-data detection (§32: training data must pass sensitive-data checks;
 * also applied at ingestion so obviously secret-bearing text is flagged).
 */
const SENSITIVE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'api-key', re: /\b(?:sk|pk|rk)-[A-Za-z0-9]{16,}\b/ },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'db-url', re: /\b(?:postgres|mysql|libsql|redis|amqp):\/\/[^\s]+:[^\s]+@/ },
  { name: 'gh-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
];

export function detectSensitiveData(text: string): string[] {
  return SENSITIVE_PATTERNS.filter(({ re }) => re.test(text)).map(({ name }) => name);
}

/**
 * Document classification heuristic when the uploader doesn't pin the type.
 * Maps heading/title/content signals to a docType.
 */
export function classifyDocument(title: string, content: string): string {
  const t = `${title}\n${content.slice(0, 2000)}`.toLowerCase();
  if (/\barchitecture\b|\bblueprint\b|\bcomponent diagram\b|\btech stack\b/.test(t)) return 'BLUEPRINT';
  if (/\barchitecture decision\b|\bADR\b|\bdecision record\b/.test(t)) return 'ADR';
  if (/\bspecification\b|\brequirements?\b|\bacceptance criteria\b/.test(t)) return 'SPEC';
  if (/\baudit\b|\breview findings\b|\bcompliance\b|\bcontrol[s]? missing\b/.test(t)) return 'AUDIT';
  if (/\brunbook\b|\boperational procedure\b|\bincident\b|\bon-call\b/.test(t)) return 'RUNBOOK';
  if (/\bpost-?mortem\b|\breview\b/.test(t)) return 'REVIEW';
  if (/\breference\b|\bglossary\b/.test(t)) return 'REFERENCE';
  return 'BLUEPRINT';
}

/**
 * Knowledge-record extraction heuristic (§4: classify content). Detects
 * statements that behave like decisions/requirements/risks/components so the
 * contradiction detector and freshness layer have normalized atoms to compare.
 */
export interface ExtractedKnowledgeAtom {
  statement: string;
  recordType: 'FACT' | 'DECISION' | 'REQUIREMENT' | 'RISK' | 'COMPONENT' | 'DEPENDENCY' | 'RECOMMENDATION';
  topicKey: string | null;
}

export function extractKnowledgeAtoms(sectionHeading: string, chunkText: string): ExtractedKnowledgeAtom[] {
  const atoms: ExtractedKnowledgeAtom[] = [];
  const sentences = chunkText.split(/(?<=[.!?])\s+/);

  for (const sentence of sentences) {
    const s = sentence.trim();
    if (s.length < 25 || s.length > 400) continue;
    let type: ExtractedKnowledgeAtom['recordType'] | null = null;

    if (/\bwe (?:have )?(?:decided|chose|selected|adopted)\b|\bdecision:\b|\bADR\b/i.test(s)) type = 'DECISION';
    else if (/\bmust\b|\bshall\b|\brequired to\b|\bneeds to\b|\bMUST\b/.test(s)) type = 'REQUIREMENT';
    else if (/\brisk\b|\bsingle point of failure\b|\bSPOF\b|\bfailure\b|\boutage\b|\bbottleneck\b/i.test(s)) type = 'RISK';
    else if (/\bdepends on\b|\bdependency\b|\bcalls\b|\bintegrates with\b/i.test(s)) type = 'DEPENDENCY';
    else if (/\brecommend\b|\bshould (?:add|introduce|migrate|implement)\b|\bconsider\b/i.test(s)) type = 'RECOMMENDATION';
    else if (/\b(?:service|database|queue|cache|cluster|gateway|api|module|component)\b/i.test(s)) type = 'COMPONENT';
    else if (/\b(?:is|are|uses|provides|stores|runs|deployed)\b/i.test(s)) type = 'FACT';

    if (!type) continue;
    atoms.push({ statement: s, recordType: type, topicKey: topicKeyFor(s, sectionHeading) });
    if (atoms.length >= 6) break; // bounded per chunk
  }
  return atoms;
}

/** Topic keys normalize comparison: technology choices, component names. */
function topicKeyFor(sentence: string, heading: string): string | null {
  const tech = sentence.match(
    /\b(postgres(?:ql)?|mysql|sqlite|libsql|turso|mongo(?:db)?|redis|memcached|kafka|rabbitmq|sqs|nats|elasticsearch|clickhouse|snowflake|s3|gcs|dynamodb|cassandra|consul|vault|kubernetes|docker|lambda|cloudflare workers|vercel|next\.?js|react|vue|angular|svelte|node(?:\.js)?|bun|deno|python|go|rust|java|\.net|graphql|grpc|rest|websocket|mqtt)\b/i
  );
  if (tech) return `tech:${tech[1].toLowerCase().replace(/\s/g, '')}`;
  const component = sentence.match(/\b([A-Z][a-zA-Z]{2,}(?:\s[A-Z][a-zA-Z]{2,}){0,2})\s+(?:service|gateway|cluster|database|queue|cache|module)\b/);
  if (component) return `component:${component[1].toLowerCase().replace(/\s/g, '-')}`;
  const headingTopic = heading.match(/([A-Za-z]{4,})/);
  if (headingTopic) return `section:${headingTopic[1].toLowerCase()}`;
  return null;
}
