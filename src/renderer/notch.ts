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

/**
 * Work with an end in sight: a model downloading, or a backlog of text
 * waiting to be embedded.
 *
 * Both of these used to happen in complete silence unless the main window
 * was open, which on a first run means the one moment the app is doing
 * something slow is the one moment it looks broken.
 */
let busy: { label: string | null; pct: number } | null = null;

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
 * The strip's furniture, in points, so the island can be sized without
 * waiting for a layout.
 *
 * Measuring `.strip-inner` directly would be the obvious way and is the
 * wrong one: the text animates its `max-width` from 0, so a measurement
 * taken the moment the class changes returns the width it is leaving, not
 * the width it is going to. `scrollWidth` on the text ignores that clamp and
 * reports the whole string, which is the number this actually wants.
 */
const BADGE_W = 18;
const GAP_W = 7;
const ISLAND_PAD = 18;

/** Matches `body.playing .strip-text`; past this the title ellipsises. */
const MAX_TEXT_W = 230;

/**
 * Width added either side of the notch when there is nothing to say.
 *
 * Idle used to be exactly notch-sized and fully transparent, which is
 * invisible by construction: the panel existed but nothing on screen said so
 * until it was hovered. This is the resting state instead -- the notch
 * reading a little wider than the hardware, which is the whole cue.
 */
const IDLE_WING = 20;

/** How far the hairline stands proud of the silhouette. */
const EDGE = 1;

/**
 * Opening happens in two moves, not one.
 *
 * A single morph from a 240pt strip to a 460x300 panel travels diagonally,
 * and what that reads as is a window being stretched. Dropping to full
 * height at the notch's own width first, then widening, reads as the notch
 * itself pouring downward and then opening out -- the shape stays attached
 * to the hardware the whole way. Closing runs the same two moves backwards,
 * narrowing before it rises, so it retracts into the notch instead of
 * shrinking toward it.
 */
const DROP_MS = 260;
const WIDEN_MS = 340;

/**
 * The silhouette's stage, which is deliberately not the same thing as the
 * `expanded` class. The class flips the instant the main process says so and
 * drives the content; the stage lags it by one move, because the shape has
 * somewhere to be in between.
 */
type NotchStage = 'closed' | 'tall' | 'wide';
let stage: NotchStage = 'closed';
let morphTimer: ReturnType<typeof setTimeout> | null = null;

/** The resting silhouette's width: the notch plus a little either side. */
function idleWidth(): number {
  return geom.notchWidth + IDLE_WING * 2;
}

/**
 * How wide the island has to be to hold what the strip is saying.
 *
 * Sized to the content rather than to a fixed wing, so a two-word capture
 * confirmation and a long track title are each given exactly the room they
 * need. Clamped below by the resting width -- it may only ever grow out of
 * the notch -- and above by the window, which is the widest the silhouette
 * can be drawn.
 */
function islandWidth(): number {
  const text = Math.min(el('lip-text').scrollWidth, MAX_TEXT_W);
  const badge = text ? BADGE_W + GAP_W : BADGE_W;
  return Math.min(
    Math.max(idleWidth(), Math.ceil(badge + text + ISLAND_PAD * 2)),
    window.innerWidth - 12
  );
}

/** How long the next clip-path interpolation should take. */
function setMorph(ms: number): void {
  document.documentElement.style.setProperty('--morph-ms', `${ms}ms`);
}

const RADII = {
  idle: { top: 8, bottom: 12 },
  island: { top: 9, bottom: 13 },
  expanded: { top: 14, bottom: 28 },
};

/**
 * What to draw with until the main process sends the real numbers, which it
 * does as soon as the page is ready and again whenever the display changes.
 * Both are only ever wrong for a frame or two.
 */
let geom = { menuBarHeight: 32, notchWidth: 180 };

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

interface NotchShape {
  w: number;
  h: number;
  top: number;
  bottom: number;
}

/** Whichever of the shapes the current state calls for. */
function currentShape(): NotchShape {
  const body = document.body;

  // The stage drives the shape, but the class still has the last word when
  // nothing has staged a move: the screenshot harness opens the panel by
  // adding the class directly, and anything else that does the same should
  // not get a closed notch drawn over an open panel.
  if (stage === 'wide' || (stage === 'closed' && body.classList.contains('expanded'))) {
    return {
      w: window.innerWidth,
      h: window.innerHeight,
      top: RADII.expanded.top,
      bottom: RADII.expanded.bottom,
    };
  }
  // Mid-open and mid-close: full height, still only as wide as the notch.
  if (stage === 'tall') {
    return {
      w: idleWidth(),
      h: window.innerHeight,
      top: RADII.expanded.top,
      bottom: RADII.expanded.bottom,
    };
  }
  if (
    body.classList.contains('pulsing') ||
    body.classList.contains('busy') ||
    body.classList.contains('playing')
  ) {
    return {
      w: islandWidth(),
      h: geom.menuBarHeight,
      top: RADII.island.top,
      bottom: RADII.island.bottom,
    };
  }
  return {
    w: idleWidth(),
    h: geom.menuBarHeight,
    top: RADII.idle.top,
    bottom: RADII.idle.bottom,
  };
}

/**
 * Clips the silhouette and, one point outside it, the hairline.
 *
 * Both are the same path with different numbers, so they interpolate
 * together and the outline never separates from the shape mid-morph.
 *
 * The radii are deliberately not grown with the size. The straight side of
 * the shape sits at `x + topR`, and x moves in by exactly the same amount
 * the width grows; adding EDGE to the radius as well puts the outline's side
 * back on top of the silhouette's, which draws no line at all. Leaving the
 * radii alone is what makes the larger path a true outset.
 */
function applyShape(): void {
  const s = currentShape();
  el('shell').style.clipPath = `path('${notchPath(s.w, s.h, s.top, s.bottom)}')`;
  el('shell-edge').style.clipPath = `path('${notchPath(
    s.w + EDGE * 2,
    s.h + EDGE,
    s.top,
    s.bottom
  )}')`;
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
  const was = stripKey();
  playing = np;
  busy = busyFrom(state);
  if (stripKey() !== was) renderStrip();

  renderNowPlaying(np);

  const paused = state.memory?.paused ?? false;
  const pause = el<HTMLButtonElement>('pause');
  pause.textContent = paused ? 'Paused' : 'Pause';
  pause.classList.toggle('on', paused);
}

/**
 * What the app is busy with, if it is busy with something measurable.
 *
 * Only determinate work counts. A bar that fills is a promise about how long
 * something will take, and the states without a number -- an embedder that
 * is merely 'loading' -- cannot keep it, so they say nothing instead.
 *
 * A null label means fill the hairline and say nothing. That distinction is
 * the whole design: a model download happens once, blocks everything and is
 * worth interrupting for, while the embedding backlog is ordinary background
 * work that can run for as long as it likes. Letting the backlog claim the
 * strip would mean a busy machine never shows what is playing again.
 */
function busyFrom(state: AppSnapshot): { label: string | null; pct: number } | null {
  const stats = state.memory?.stats;
  if (!stats) return null;

  const e = stats.embedder;
  if (e?.status === 'downloading') {
    return { label: 'Downloading model', pct: clampPct(e.progress) };
  }

  // The backlog: text is stored and searchable by keyword the moment it
  // arrives, and the vectors land behind it. That gap is the wait.
  const done = stats.embedded;
  const total = done + stats.pending;
  if (e?.ready && stats.pending > 0 && total > 0) {
    return { label: null, pct: clampPct((done / total) * 100) };
  }

  return null;
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}

/**
 * The same track, said properly, for the panel.
 *
 * The strip has one line and has to compress everything into it; here there
 * is room to separate what is playing from where it is playing, and to show
 * the icon at a size that is actually recognisable.
 */
function renderNowPlaying(np: AppNowPlaying | null): void {
  const card = el('now');
  card.hidden = !np;
  if (!np) return;

  const art = el<HTMLImageElement>('np-art');
  if (np.icon) art.src = np.icon;
  else art.removeAttribute('src');
  art.hidden = !np.icon;

  // With a title, the app is the subtitle. Without one, the app is all there
  // is, so it becomes the title and the subtitle carries the caveat.
  el('np-title').textContent = np.title || np.app;
  el('np-sub').textContent = np.title
    ? [np.artist, np.app].filter(Boolean).join(' · ')
    : 'Playing — the track cannot be read from here';
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

  // Whichever direction was in flight, it is not the one we want now.
  if (morphTimer) clearTimeout(morphTimer);

  // Both directions pass through 'tall'; only the order and the timing of
  // the two moves differ.
  stage = 'tall';
  setMorph(on ? DROP_MS : WIDEN_MS);
  applyShape();

  morphTimer = setTimeout(
    () => {
      morphTimer = null;
      stage = on ? 'wide' : 'closed';
      setMorph(on ? WIDEN_MS : DROP_MS);
      applyShape();
    },
    on ? DROP_MS : WIDEN_MS
  );

  if (on) {
    el('q').focus();
  } else {
    const q = el<HTMLInputElement>('q');
    q.value = '';
    q.blur();
    renderNotchHits([], '');
  }
}

/**
 * Everything the strip draws itself from, as one string.
 *
 * Compared rather than diffed field by field so that a poll which changes
 * nothing -- which is most of them -- does not touch the DOM. The percentage
 * is in it because the bar has to move.
 */
function stripKey(): string {
  return [
    playing ? trackLine(playing) : '',
    playing?.icon ? '1' : '0',
    busy ? `${busy.label ?? ''}|${Math.round(busy.pct)}` : '',
  ].join('\u0000');
}

/** What is playing, as one line. */
function trackLine(np: AppNowPlaying): string {
  // macOS can often name the app but not the track: a browser is playing
  // something and there is no supported way to ask what. Saying where it is
  // coming from is still worth more than saying nothing.
  if (!np.title) return `Playing in ${np.app}`;
  return np.artist ? `${np.title} — ${np.artist}` : np.title;
}

/**
 * The single place that decides what the closed strip shows, so the two
 * things that can claim it cannot end up half-applied between them.
 *
 * It grows sideways on the notch's own line rather than downward, so it
 * never covers anything that was not already the notch.
 */
/**
 * What the closed strip shows, in priority order.
 *
 * A capture confirmation is news and wins outright; it is gone in two
 * seconds. Work in progress outranks what is playing, because one of them
 * ends and the other is ambient -- and because the hairline is filling for
 * it either way, so a strip still talking about a track would be labelling
 * the wrong thing.
 */
function renderStrip(): void {
  const body = document.body;
  const showBusy = pulseLabel === null && busy?.label != null;
  const showPlaying = pulseLabel === null && !showBusy && playing !== null;

  body.classList.toggle('pulsing', pulseLabel !== null);
  body.classList.toggle('busy', showBusy);
  body.classList.toggle('playing', showPlaying);

  el('lip-text').textContent =
    pulseLabel ?? (showBusy ? busy!.label! : showPlaying ? trackLine(playing!) : '');

  // The hairline is the progress track: it is already drawn around the whole
  // silhouette, so filling part of it costs no new geometry.
  document.documentElement.style.setProperty('--progress', `${busy ? busy.pct : 0}%`);

  // The icon belongs to what is playing, so a capture's pulse and a download
  // borrow the dot instead: neither is the player talking.
  const art = el<HTMLImageElement>('art');
  const icon = showPlaying ? (playing?.icon ?? '') : '';
  if (icon) art.src = icon;
  else art.removeAttribute('src');
  art.hidden = !icon;
  body.classList.toggle('has-art', Boolean(icon));

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
