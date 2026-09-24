/**
 * The recall overlay's script. A plain script with no imports, same as the
 * notch and the main window, so tsc emits it without a module wrapper. That
 * also means all three share one global scope as far as the compiler is
 * concerned, which is why everything here carries a Recall- prefix.
 *
 * Deliberately thin: a search box and a list of hits. Nothing here opens,
 * edits, or forgets anything -- that is what the full window is for, and
 * Enter (or a click) hands the query straight to it.
 */

const recallEl = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let recallSearchSeq = 0;

function renderRecallHits(hits: AppHit[], query: string): void {
  const list = recallEl('hits');
  const empty = recallEl('empty');

  if (!query) {
    list.replaceChildren();
    empty.hidden = false;
    empty.textContent = 'Start typing to search.';
    return;
  }
  if (!hits.length) {
    list.replaceChildren();
    empty.hidden = false;
    empty.textContent = `Nothing matches "${query}".`;
    return;
  }
  empty.hidden = true;

  list.replaceChildren(
    ...hits.map((h) => {
      const li = document.createElement('li');
      li.className = 'hit';

      const top = document.createElement('div');
      top.className = 't';
      const src = document.createElement('span');
      src.textContent = h.source;
      top.append(src);
      if (h.title) {
        const t = document.createElement('span');
        t.textContent = h.title;
        top.append(t);
      }

      const body = document.createElement('div');
      body.className = 'b';
      body.textContent = h.text;

      li.append(top, body);
      // A click is the same handoff Enter does -- this is a launcher, not a
      // place to read the full chunk.
      li.addEventListener('click', () => openRecallInWindow());
      return li;
    })
  );
}

async function runRecallSearch(): Promise<void> {
  const seq = ++recallSearchSeq;
  const q = recallEl<HTMLInputElement>('q').value.trim();
  const hits = q ? await window.api.searchMemory(q, { k: 8 }) : [];
  if (seq !== recallSearchSeq) return;
  renderRecallHits(hits, q);
}

/** Hands the current query to the main window; losing focus dismisses this one. */
function openRecallInWindow(): void {
  const q = recallEl<HTMLInputElement>('q').value.trim();
  if (!q) return;
  void window.api.openMemory(q);
}

function resetRecall(): void {
  const input = recallEl<HTMLInputElement>('q');
  input.value = '';
  renderRecallHits([], '');
  input.focus();
}

let recallDebounce: ReturnType<typeof setTimeout> | null = null;
recallEl<HTMLInputElement>('q').addEventListener('input', () => {
  if (recallDebounce) clearTimeout(recallDebounce);
  recallDebounce = setTimeout(() => void runRecallSearch(), 100);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    void window.api.closeRecall();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    openRecallInWindow();
  }
});

// The window is reused rather than recreated between summons, so this is
// what makes reopening it feel fresh instead of showing last time's search.
window.api.onRecallShown(() => resetRecall());

resetRecall();
