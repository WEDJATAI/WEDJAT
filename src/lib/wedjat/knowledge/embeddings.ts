// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Local deterministic embedding model (§18 HF role, §17 policy).
//
// WHY: the embedding policy is LOCAL_ONLY — proprietary blueprint text must never
// leave the org boundary to build retrieval indexes. This in-process embedder
// plays the "Hugging Face local model" role: hashed bag-of-ngrams projection to
// a fixed 256-d space with sublinear TF and corpus IDF weighting, L2-normalized.
// Deterministic → the same text always yields the same vector (reproducibility §75).
// ═══════════════════════════════════════════════════════════════════════════════

import { config } from '../config';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'by',
  'for', 'with', 'about', 'into', 'through', 'during', 'to', 'from', 'up', 'down',
  'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'once', 'here',
  'there', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'can', 'will', 'just', 'should', 'now', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'of',
  'it', 'its', 'this', 'that', 'these', 'those', 'as', 'we', 'you', 'they', 'he',
  'she', 'which', 'what', 'who', 'whom', 'how', 'why', 'where', 'also', 'may',
  'must', 'shall', 'might', 'would', 'could', 'i', 'me', 'my', 'our', 'their',
]);

/** Lightweight suffix stripper (not a full stemmer — deterministic is what matters). */
function stem(word: string): string {
  return word
    .replace(/(ations|ation|ions|ing|ers|ies|ed|es|s)$/, (m) => (word.length - m.length >= 4 ? '' : m))
    .replace(/(ational|tional|alize|alise|ize|ise|ate|ous|ive|ful|ness|ment)$/, (m) =>
      word.length - m.length >= 5 ? '' : m
    );
}

export function tokenize(text: string): string[] {
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return raw.map(stem).filter((t) => t.length > 1);
}

/** FNV-1a 32-bit hash — fast, deterministic. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Corpus-level IDF statistics (rebuilt lazily; cached per process). */
let idfCache: Map<string, number> | null = null;
let idfDocCount = 0;
let idfBuiltAt = 0;

export function corpusIdf(): { idf: Map<string, number>; docCount: number } {
  if (idfCache && Date.now() - idfBuiltAt < 60_000) {
    return { idf: idfCache, docCount: idfDocCount };
  }
  return { idf: idfCache ?? new Map(), docCount: idfDocCount };
}

/**
 * Rebuild IDF from a corpus of tokenized documents. Called by the indexer after
 * ingestion so embeddings and query vectors share the same weighting.
 * NOTE: the vector itself is TF-hash-projected; IDF applies at similarity time
 * via term weights to avoid re-embedding the corpus when IDF shifts.
 */
export function rebuildIdf(tokenizedDocs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const tokens of tokenizedDocs) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = Math.max(1, tokenizedDocs.length);
  const idf = new Map<string, number>();
  for (const [term, d] of df) {
    idf.set(term, Math.log(1 + N / (1 + d)));
  }
  idfCache = idf;
  idfDocCount = N;
  idfBuiltAt = Date.now();
  return idf;
}

/**
 * Embeds text into a fixed 256-d unit vector using the hashing trick over
 * unigrams + bigrams with sublinear TF.
 */
export function embed(text: string): { vector: number[]; norm: number } {
  const dim = config.retrieval.embedderDimension;
  const vector = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);

  const counts = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    counts.set(tokens[i], (counts.get(tokens[i]) ?? 0) + 1);
    if (i + 1 < tokens.length) {
      const bigram = `${tokens[i]}_${tokens[i + 1]}`;
      counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
    }
  }

  for (const [term, count] of counts) {
    const tf = 1 + Math.log(count); // sublinear TF
    const h = fnv1a(term);
    const idx = h % dim;
    // Sign from a second hash slice to reduce collision bias.
    const sign = (h >>> 16) % 2 === 0 ? 1 : -1;
    vector[idx] += sign * tf;
  }

  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return { vector: vector.map((v) => v / norm), norm };
}

/** Cosine similarity — vectors are L2-normalized, so a dot product suffices. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

export const EMBEDDER_MODEL = config.retrieval.embedderModel;
export const EMBEDDER_DIMENSION = config.retrieval.embedderDimension;
