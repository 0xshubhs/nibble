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

/**
 * The two things the closed strip can say, in priority order.
 *
 * A capture is transient and always wins: it is news, and it is gone in two
 * seconds. What is playing is ambient and sits underneath, so the strip
 * returns to it rather than to nothing.
 */
let pulseLabel: string | null = null;
let playing: AppNowPlaying | null = null;

/* ============================================================
   the shape

   The panel is one silhouette clipped to a notch-shaped path: two
   concave flares where it meets the top of the screen, two convex
   corners at the bottom. Collapsed it is the size of the notch,
   which is why it reads as the notch growing rather than as a
   window appearing near it.

   All three paths are the same sequence of commands with different
   numbers in them, which is the whole trick: a browser will
   interpolate one path into another only when their commands line
   up, so the morph costs a transition rather than a frame loop.
   ============================================================ */

/**
 * Width added either side of the notch when the strip has something to say.
 * A track needs more room than a two-word confirmation does.
 */
const PULSE_WING = 72;
const MEDIA_WING = 122;

const RADII = {
  collapsed: { top: 7, bottom: 9 },
  island: { top: 9, bottom: 13 },
  expanded: { top: 14, bottom: 28 },
};

let geom = { menuBarHeight: 32, notchWidth: 200 };

/**
 * A notch-shaped path `w` by `h`, centred in the window.
 *
 * The top corners start at the screen edge and curve inward to a point
 * inset by the flare, with the control point on the top edge: that is what
 * makes them concave, so the shape appears to hang from the edge rather
 * than to sit below it. The bottom corners put the control point at the
 * corner itself, which is an ordinary rounded corner.
 *
 * Both radii are clamped against the current size, not the target size,
 * because early in the animation the shape is small enough for an unclamped
 * curve to fold through itself. The flare is clamped against the height as
 * well as the width: on a shape shorter than the flare is deep, the top
 * curve would otherwise finish below where the bottom curve starts, and the
 * side would run backwards.
 */
function notchPath(w: number, h: number, topR: number, bottomR: number): string {
  const x = Math.round((window.innerWidth - w) / 2);
  const t = Math.min(topR, w / 4, h / 2);
  const b = Math.min(bottomR, h - t, (w - 2 * t) / 2);
  const r = (n: number): string => n.toFixed(2);

  return [
    `M ${r(x)} 0`,
    `Q ${r(x + t)} 0 ${r(x + t)} ${r(t)}`,
    `L ${r(x + t)} ${r(h - b)}`,
    `Q ${r(x + t)} ${r(h)} ${r(x + t + b)} ${r(h)}`,
    `L ${r(x + w - t - b)} ${r(h)}`,
    `Q ${r(x + w - t)} ${r(h)} ${r(x + w - t)} ${r(h - b)}`,
    `L ${r(x + w - t)} ${r(t)}`,
    `Q ${r(x + w - t)} 0 ${r(x + w)} 0`,
    'Z',
  ].join(' ');
}

/** Whichever of the three shapes the current state calls for. */
function applyShape(): void {
  const shell = el('shell');
  const body = document.body;

  if (body.classList.contains('expanded')) {
    shell.style.clipPath = `path('${notchPath(window.innerWidth, window.innerHeight, RADII.expanded.top, RADII.expanded.bottom)}')`;
    return;
  }
  if (body.classList.contains('pulsing') || body.classList.contains('playing')) {
    const wing = body.classList.contains('pulsing') ? PULSE_WING : MEDIA_WING;
    shell.style.clipPath = `path('${notchPath(geom.notchWidth + wing * 2, geom.menuBarHeight, RADII.island.top, RADII.island.bottom)}')`;
    return;
  }
  shell.style.clipPath = `path('${notchPath(geom.notchWidth, geom.menuBarHeight, RADII.collapsed.top, RADII.collapsed.bottom)}')`;
}

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

  // Live, not stored: the media source reports this the moment a track
  // starts, long before it has been playing long enough to be remembered.
  const np = state.memory?.sources.find((s) => s.id === 'media')?.state.nowPlaying ?? null;
  const changed = (playing ? trackLine(playing) : '') !== (np ? trackLine(np) : '');
  playing = np;
  if (changed) renderStrip();

  const now = el('now');
  now.hidden = !np;
  now.textContent = np ? `♪ ${trackLine(np)}` : '';

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
  applyShape();
  if (on) {
    el('q').focus();
  } else {
    const q = el<HTMLInputElement>('q');
    q.value = '';
    q.blur();
    renderNotchHits([], '');
  }
}

/** What is playing, as one line. */
function trackLine(np: AppNowPlaying): string {
  return np.artist ? `${np.title} — ${np.artist}` : np.title;
}

/**
 * The single place that decides what the closed strip shows, so the two
 * things that can claim it cannot end up half-applied between them.
 *
 * It grows sideways on the notch's own line rather than downward, so it
 * never covers anything that was not already the notch.
 */
function renderStrip(): void {
  const body = document.body;
  body.classList.toggle('pulsing', pulseLabel !== null);
  body.classList.toggle('playing', pulseLabel === null && playing !== null);

  el('lip-text').textContent = pulseLabel ?? (playing ? trackLine(playing) : '');
  applyShape();
}

function pulse(label: string): void {
  pulseLabel = label;
  renderStrip();
  if (pulseTimer) clearTimeout(pulseTimer);
  pulseTimer = setTimeout(() => {
    pulseLabel = null;
    // Back to whatever was underneath, which is usually nothing.
    renderStrip();
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
    geom = g;
    const root = document.documentElement;
    root.style.setProperty('--menubar-h', `${g.menuBarHeight}px`);
    root.style.setProperty('--notch-w', `${g.notchWidth}px`);
    applyShape();
  });
  window.api.onNotchExpanded((on) => setExpanded(on));
  window.api.onNotchPulse((label) => pulse(label));
  window.api.onState((s) => paint(s));
}

void (async function init(): Promise<void> {
  bindNotch();
  // The shape has to exist before the first transition, or the panel's
  // first open animates from no clip at all, which is a full-screen black
  // rectangle collapsing into a notch.
  applyShape();
  paint(await window.api.getState());
})();
