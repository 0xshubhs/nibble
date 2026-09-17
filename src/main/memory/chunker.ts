/**
 * Splits captured text into overlapping chunks small enough to embed well.
 *
 * Embedding models have a hard token ceiling (all-MiniLM truncates at 256
 * word-pieces), so a long document embedded whole loses everything past the
 * cutoff. Chunking with overlap keeps a sentence that straddles a boundary
 * retrievable from either side.
 */

export const TARGET = 900; // characters, comfortably inside 256 word-pieces
export const MAX = 1400;
export const OVERLAP = 160;
export const MIN = 24; // below this a chunk is noise, not memory

export interface Chunk {
  text: string;
  offset: number;
}

/** Prefers paragraph breaks, then sentence ends, then whitespace. */
function findBreak(text: string, from: number, to: number): number {
  const window = text.slice(from, to);
  const para = window.lastIndexOf('\n\n');
  if (para > TARGET * 0.4) return from + para + 2;

  // Sentence end followed by a space -- avoids splitting "v1.2. " style text.
  for (let i = window.length - 1; i > TARGET * 0.4; i--) {
    const c = window[i];
    if ((c === '.' || c === '!' || c === '?' || c === '\n') && /\s/.test(window[i + 1] ?? ' ')) {
      return from + i + 1;
    }
  }
  const space = window.lastIndexOf(' ');
  return space > TARGET * 0.4 ? from + space + 1 : to;
}

export function normalize(text: unknown): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chunk(raw: unknown): Chunk[] {
  const text = normalize(raw);
  if (text.length < MIN) return [];
  if (text.length <= MAX) return [{ text, offset: 0 }];

  const out: Chunk[] = [];
  let pos = 0;
  while (pos < text.length) {
    const hardEnd = Math.min(pos + MAX, text.length);
    const end = hardEnd === text.length ? hardEnd : findBreak(text, pos, hardEnd);
    const slice = text.slice(pos, end).trim();
    if (slice.length >= MIN) out.push({ text: slice, offset: pos });
    if (end >= text.length) break;
    // Step back for overlap, but never far enough to fail to advance.
    pos = Math.max(end - OVERLAP, pos + 1);
  }
  return out;
}
