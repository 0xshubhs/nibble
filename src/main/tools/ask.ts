import fs from 'fs';
import path from 'path';
import type { AskSource, AskTurn, SearchHit } from '../../types';

/**
 * Conversational recall, without leaving the app for Claude Desktop.
 *
 * Retrieval is always local -- the same hybrid search every other surface in
 * the app uses. Only the question and the handful of chunks it turned up
 * ever cross the network, and only once a key has actually been typed in:
 * no key, no call, and the panel says so rather than failing silently.
 *
 * Gemini specifically, not the embedding backend picker -- Voyage has no
 * chat completion endpoint at all, so "the same backend switch" would be a
 * lie for half its settings. `askApiKey` is its own field for exactly that
 * reason; see the note on it in types.ts.
 */

const MODEL = 'gemini-2.0-flash';
const MAX_CONTEXT_CHUNKS = 6;
const MAX_CHUNK_CHARS = 600;
const FETCH_TIMEOUT_MS = 20_000;

function endpoint(key: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;
}

function buildPrompt(question: string, hits: SearchHit[]): string {
  const context = hits
    .map((h, i) => {
      const when = new Date(h.ts).toLocaleString();
      const text =
        h.text.length > MAX_CHUNK_CHARS ? `${h.text.slice(0, MAX_CHUNK_CHARS)}…` : h.text;
      return `[${i + 1}] (${h.source}, ${when}) ${h.title ? `${h.title}: ` : ''}${text}`;
    })
    .join('\n\n');

  return [
    "You answer questions using only the memory excerpts below, captured by the person asking. Cite them by their [n] number where it matters.",
    "If nothing here answers the question, say so plainly rather than guessing.",
    '',
    context || '(nothing in memory matched this question)',
    '',
    `Question: ${question}`,
  ].join('\n');
}

async function callGemini(key: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(key), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gemini said ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

export interface AskDeps {
  /** The same local hybrid search every other surface calls. */
  search(query: string, opts: { k: number }): Promise<SearchHit[]>;
  /** Read fresh each call, so typing in a key mid-session works immediately. */
  apiKey(): string;
}

export class AskHistory {
  private readonly file: string;
  private turns: AskTurn[] = [];

  constructor(dir: string) {
    this.file = path.join(dir, 'tools-ask.json');
    this.turns = this.read();
  }

  private read(): AskTurn[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private write(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      // The transcript is bounded rather than pruned by age -- a long-lived
      // install should not lose last week's answers just because this week
      // was quiet, but it also should not grow forever.
      fs.writeFileSync(this.file, JSON.stringify(this.turns.slice(-200)));
    } catch {
      /* the in-memory list is still correct even if the save failed */
    }
  }

  list(): AskTurn[] {
    return [...this.turns];
  }

  clear(): AskTurn[] {
    this.turns = [];
    this.write();
    return this.list();
  }

  /** Runs the question, records the turn either way, and returns it. */
  async ask(question: string, deps: AskDeps): Promise<AskTurn> {
    const q = question.trim();
    const turn: AskTurn = {
      id: `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      question: q,
      answer: '',
      sources: [],
      error: null,
      ts: Date.now(),
    };

    if (!q) {
      turn.error = 'empty';
      return turn;
    }

    const key = deps.apiKey().trim();
    if (!key) {
      turn.error = 'no-key';
      this.turns.push(turn);
      this.write();
      return turn;
    }

    try {
      const hits = await deps.search(q, { k: MAX_CONTEXT_CHUNKS });
      const sources: AskSource[] = hits.map((h) => ({ id: h.id, title: h.title, source: h.source }));
      const answer = await callGemini(key, buildPrompt(q, hits));
      turn.answer = answer || 'No answer came back.';
      turn.sources = sources;
    } catch (err) {
      turn.error = err instanceof Error ? err.message : String(err);
    }

    this.turns.push(turn);
    this.write();
    return turn;
  }
}
