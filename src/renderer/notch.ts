/**
 * The notch panel's script. Like the main window's renderer this is a plain
 * script with no imports, so tsc emits it without a module wrapper. That also
 * means both files share one global scope as far as the compiler is
 * concerned, which is why everything here carries a Notch- prefix.
 *
 * It is deliberately thin: search, the next reminder, a pause toggle, and a
 * drop target. Anything that needs real screen space belongs in the window.
 */

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let pulseTimer: ReturnType<typeof setTimeout> | null = null;
let searchSeq = 0;

/* ---------------- state from the main process ---------------- */

function paint(state: AppSnapshot | null): void {
  if (!state) return;

  const upcoming = [...state.reminders]
    .filter((r) => r.enabled)
    .sort((a, b) => (a.snoozedUntil ?? a.at) - (b.snoozedUntil ?? b.at))[0];

  el('next').textContent = upcoming
    ? `${upcoming.title} · ${new Date(upcoming.snoozedUntil ?? upcoming.at).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })}`
    : 'No reminders';

  const paused = state.memory?.paused ?? false;
  const pause = el<HTMLButtonElement>('pause');
  pause.textContent = paused ? 'Paused' : 'Pause';
  pause.classList.toggle('on', paused);
}

/* ---------------- search ---------------- */

function renderNotchHits(hits: AppHit[], query: string): void {
  const list = el('hits');
  const empty = el('empty');

  if (!hits.length) {
    list.replaceChildren();
    empty.hidden = false;
    empty.textContent = query
      ? `Nothing matches "${query}".`
      : 'Drop text or a file here to remember it.';
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
      return li;
    })
  );
}

async function runNotchSearch(): Promise<void> {
  const seq = ++searchSeq;
  const q = el<HTMLInputElement>('q').value.trim();
  const hits = q ? await window.api.searchMemory(q, { k: 6 }) : [];
  if (seq !== searchSeq) return;
  renderNotchHits(hits, q);
}

/* ---------------- expand / collapse ---------------- */

function setExpanded(on: boolean): void {
  document.body.classList.toggle('expanded', on);
  if (on) {
    el('q').focus();
  } else {
    const q = el<HTMLInputElement>('q');
    q.value = '';
    q.blur();
    renderNotchHits([], '');
  }
}

function pulse(label: string): void {
  document.body.classList.add('pulsing');
  el('lip-text').textContent = label;
  if (pulseTimer) clearTimeout(pulseTimer);
  pulseTimer = setTimeout(() => {
    document.body.classList.remove('pulsing');
    el('lip-text').textContent = '';
  }, 2200);
}

/* ---------------- drop to remember ---------------- */

function bindNotchDrop(): void {
  let depth = 0;

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth++;
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    depth = Math.max(0, depth - 1);
    if (depth === 0) document.body.classList.remove('dragging');
  });

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    if (!e.dataTransfer) return;

    const files = [...e.dataTransfer.files];
    if (files.length) {
      // The renderer is sandboxed, so a File has no usable path; the preload
      // resolves it through webUtils and the main process reads it.
      const paths = files.map((f) => window.api.pathForFile(f)).filter(Boolean);
      void window.api.rememberFiles(paths).then((n) => pulse(`${n} remembered`));
      return;
    }

    const text = e.dataTransfer.getData('text/plain').trim();
    if (!text) return;
    void window.api
      .captureNote({ text, title: 'Dropped' })
      .then((res) => pulse(res.added ? 'Remembered' : (res.skipped ?? 'Skipped')));
  });
}

/* ---------------- wiring ---------------- */

function bindNotch(): void {
  let debounce: ReturnType<typeof setTimeout> | null = null;
  el('q').addEventListener('input', () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void runNotchSearch(), 170);
  });

  // Escape anywhere in the panel, not only while the search box has focus.
  // Hiding the body is not enough on its own: until the main process knows,
  // the window goes on swallowing clicks meant for whatever is underneath.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    setExpanded(false);
    void window.api.closeNotch();
  });

  el('pause').addEventListener('click', () => {
    const on = !el('pause').classList.contains('on');
    void window.api.setPaused(on);
  });

  el('open').addEventListener('click', () => void window.api.showWindow());

  bindNotchDrop();

  window.api.onNotchGeometry((g) => {
    const root = document.documentElement;
    root.style.setProperty('--menubar-h', `${g.menuBarHeight}px`);
    root.style.setProperty('--notch-w', `${g.notchWidth}px`);
  });
  window.api.onNotchExpanded((on) => setExpanded(on));
  window.api.onNotchPulse((label) => pulse(label));
  window.api.onState((s) => paint(s));
}

void (async function init(): Promise<void> {
  bindNotch();
  paint(await window.api.getState());
})();
