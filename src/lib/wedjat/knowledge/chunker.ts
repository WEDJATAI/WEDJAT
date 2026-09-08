// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Section extraction & chunking (§8: SECTION EXTRACTION →
// CHUNKING). Markdown-heading-aware so chunks keep their section lineage, which
// the context assembler and citations rely on (§13).
// ═══════════════════════════════════════════════════════════════════════════════

import { config } from '../config';
import { contentHash, sha256 } from '../ids';
import { scoreTextQuality } from './quality';

export interface ExtractedSection {
  ordinal: number;
  heading: string;
  level: number;
  content: string;
}

export interface ExtractedChunk {
  ordinal: number;
  sectionOrdinal: number | null;
  sectionHeading: string | null;
  content: string;
  tokenEstimate: number;
  qualityScore: number;
  checksum: string;
}

/** Splits raw markdown-like text into sections by heading depth. */
export function extractSections(raw: string): ExtractedSection[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const sections: ExtractedSection[] = [];
  let currentHeading = 'Untitled';
  let currentLevel = 1;
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (content.length > 0 || sections.length === 0) {
      sections.push({
        ordinal: sections.length,
        heading: currentHeading,
        level: currentLevel,
        content,
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (match) {
      flush();
      currentLevel = match[1].length;
      currentHeading = match[2].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * Chunks each section into ~targetToken pieces on sentence boundaries with
 * one-sentence overlap, attaching quality scores and content checksums for
 * deduplication (§30). Chunks below qualityThreshold are marked for EXCLUDED.
 */
export function chunkSections(sections: ExtractedSection[]): ExtractedChunk[] {
  const chunks: ExtractedChunk[] = [];
  let ordinal = 0;

  for (const section of sections) {
    const sentences = splitSentences(section.content);
    if (sentences.length === 0) continue;

    let current: string[] = [];
    let currentTokens = 0;

    const emit = () => {
      if (current.length === 0) return;
      const content = current.join(' ').trim();
      if (!content) return;
      const tokenEstimate = Math.ceil(content.length / 4);
      const quality = scoreTextQuality(content);
      chunks.push({
        ordinal: ordinal++,
        sectionOrdinal: section.ordinal,
        sectionHeading: section.heading,
        content,
        tokenEstimate,
        qualityScore: quality.score,
        checksum: contentHash(content),
      });
      current = [];
      currentTokens = 0;
    };

    for (const sentence of sentences) {
      const sTokens = Math.ceil(sentence.length / 4);
      // Oversized single sentence → hard split on word boundary.
      if (sTokens > config.chunking.targetTokens) {
        emit();
        for (const piece of hardSplit(sentence, config.chunking.targetTokens * 4)) {
          current.push(piece);
          emit();
        }
        continue;
      }
      if (currentTokens + sTokens > config.chunking.targetTokens && currentTokens >= config.chunking.minTokens) {
        // Keep one sentence of overlap for continuity.
        const overlap = current[current.length - 1] ?? '';
        emit();
        if (overlap) {
          current.push(overlap);
          currentTokens = Math.ceil(overlap.length / 4);
        }
      }
      current.push(sentence);
      currentTokens += sTokens;
    }
    emit();
  }

  return chunks;
}

function splitSentences(text: string): string[] {
  // Keep list items and code lines intact as pseudo-sentences.
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function hardSplit(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let buf: string[] = [];
  let len = 0;
  for (const w of words) {
    if (len + w.length + 1 > maxChars && buf.length > 0) {
      out.push(buf.join(' '));
      buf = [];
      len = 0;
    }
    buf.push(w);
    len += w.length + 1;
  }
  if (buf.length) out.push(buf.join(' '));
  return out;
}

/** Document-level integrity hash (§30 source hashing). */
export function documentChecksum(raw: string): string {
  return sha256(raw);
}
