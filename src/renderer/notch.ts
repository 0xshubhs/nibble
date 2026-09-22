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
let messageLabel: string | null = null;
let messageTimer: ReturnType<typeof setTimeout> | null = null;
/** Set only while a scratchpad is both pinned and non-empty. */
let pinnedScratchText: string | null = null;

/* ---------------- small icons ----------------
   The rail's icons live as literal <svg> in notch.html because there are
   eleven of them and they never change. These two are generated at runtime
   -- inside a clipboard entry, inside a shelf row -- so they're built the
   same way the rest of that markup is, from trusted strings this file
   itself wrote, never from anything a person typed. */

const ICON_PIN =
  '<svg viewBox="0 0 20 20" class="mini-icon"><circle cx="10" cy="8" r="3.2"/><line x1="10" y1="11" x2="10" y2="17"/></svg>';
const ICON_FILE =
  '<svg viewBox="0 0 20 20" class="mini-icon"><rect x="5" y="3" width="10" height="14" rx="1"/><line x1="7.5" y1="7.5" x2="12.5" y2="7.5"/><line x1="7.5" y1="10.5" x2="12.5" y2="10.5"/></svg>';

/* ---------------- tabs ---------------- */

const TAB_IDS = [
  'home',
  'search',
  'clipboard',
  'shelf',
  'notes',
  'scratchpad',
  'timers',
  'stats',
  'calendar',
  'weather',
  'message',
] as const;
type TabId = (typeof TAB_IDS)[number];
let activeTab: TabId = 'home';

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
    body.classList.contains('playing') ||
    body.classList.contains('messaging')
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

  if (activeTab === 'home') renderHome();
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

/* ---------------- clipboard ---------------- */

let clipSearchSeq = 0;

function renderClipboard(entries: AppClipboardEntry[], query: string): void {
  const list = el('clip-list');
  const empty = el('clip-empty');

  if (!entries.length) {
    list.replaceChildren();
    empty.hidden = false;
    empty.textContent = query ? `Nothing matches "${query}".` : 'Nothing copied yet.';
    return;
  }
  empty.hidden = true;

  list.replaceChildren(
    ...entries.map((entry) => {
      const li = document.createElement('li');
      li.className = 'hit';

      const row = document.createElement('div');
      row.className = 'hit-row';

      const body = document.createElement('div');
      body.className = 'b';
      body.textContent = entry.text;

      const actions = document.createElement('div');
      actions.className = 'hit-actions';

      const pin = document.createElement('button');
      pin.className = `mini${entry.pinned ? ' on' : ''}`;
      pin.type = 'button';
      pin.title = entry.pinned ? 'Unpin' : 'Pin';
      pin.innerHTML = ICON_PIN;
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        void window.api
          .clipboardPin(entry.id, !entry.pinned)
          .then((rows) => renderClipboard(rows, el<HTMLInputElement>('clip-q').value.trim()));
      });

      const remove = document.createElement('button');
      remove.className = 'mini';
      remove.type = 'button';
      remove.title = 'Remove';
      remove.textContent = '✕';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        void window.api
          .clipboardRemove(entry.id)
          .then((rows) => renderClipboard(rows, el<HTMLInputElement>('clip-q').value.trim()));
      });

      actions.append(pin, remove);
      row.append(body, actions);
      li.append(row);
      li.addEventListener('click', () => {
        void window.api.clipboardCopy(entry.id).then((ok) => ok && pulse('Copied'));
      });
      return li;
    })
  );
}

async function loadClipboard(query = ''): Promise<void> {
  const seq = ++clipSearchSeq;
  const rows = await window.api.clipboardList(query);
  if (seq !== clipSearchSeq) return;
  renderClipboard(rows, query);
}

/* ---------------- shelf ---------------- */

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

function renderShelf(items: AppShelfItem[]): void {
  const list = el('shelf-list');
  const empty = el('shelf-empty');

  if (!items.length) {
    list.replaceChildren();
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement('li');
      li.className = 'shelf-item';
      li.draggable = true;
      li.title = 'Drag out to Finder or another app';

      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.innerHTML = ICON_FILE;

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.name;

      const size = document.createElement('span');
      size.className = 'size';
      size.textContent = formatBytes(item.size);

      const remove = document.createElement('button');
      remove.className = 'mini';
      remove.type = 'button';
      remove.title = 'Remove';
      remove.textContent = '✕';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        void window.api.shelfRemove(item.id).then(renderShelf);
      });

      li.append(icon, name, size, remove);
      // The HTML5 drag is cancelled immediately: Electron's own startDrag,
      // fired through main, is what actually hands the OS a real file.
      li.addEventListener('dragstart', (e) => {
        e.preventDefault();
        window.api.shelfStartDrag(item.id);
      });
      return li;
    })
  );
}

async function loadShelf(): Promise<void> {
  renderShelf(await window.api.shelfList());
}

/* ---------------- timers ---------------- */

let timerKind: AppTimerKind = 'pomodoro';

function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function renderTimers(state: AppTimersState): void {
  if (state.active) timerKind = state.active;

  document.querySelectorAll<HTMLButtonElement>('#timer-modes .ghost').forEach((b) => {
    b.classList.toggle('on', b.dataset.kind === timerKind);
  });

  const showingActive = state.active === timerKind;
  const seconds = showingActive
    ? state.seconds
    : timerKind === 'countdown'
      ? state.countdownTotal
      : timerKind === 'pomodoro'
        ? 25 * 60
        : 0;
  el('timer-time').textContent = fmtClock(seconds);

  const phase = el('timer-phase');
  phase.hidden = timerKind !== 'pomodoro';
  phase.textContent = state.pomodoroPhase === 'work' ? 'Work' : 'Break';

  el('timer-presets').hidden = timerKind !== 'countdown';
  document.querySelectorAll<HTMLButtonElement>('#timer-presets .ghost').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.secs) === state.countdownTotal);
  });

  const toggle = el<HTMLButtonElement>('timer-toggle');
  const running = showingActive && state.running;
  toggle.textContent = running ? 'Pause' : 'Start';
  toggle.classList.toggle('on', running);

  const hydOn = el<HTMLInputElement>('hydration-on');
  hydOn.checked = state.hydrationEnabled;
  const mins = el<HTMLInputElement>('hydration-mins');
  if (document.activeElement !== mins) mins.value = String(state.hydrationMinutes);
  el('hydration-note').textContent =
    state.hydrationEnabled && state.hydrationNextAt
      ? `Next in ${fmtClock((state.hydrationNextAt - Date.now()) / 1000)}`
      : 'Off';
}

async function loadTimers(): Promise<void> {
  renderTimers(await window.api.timersGet());
}

function bindTimers(): void {
  document.querySelectorAll<HTMLButtonElement>('#timer-modes .ghost').forEach((b) => {
    b.addEventListener('click', () => {
      timerKind = b.dataset.kind as AppTimerKind;
      void window.api.timersGet().then(renderTimers);
    });
  });

  el('timer-toggle').addEventListener('click', () => {
    void window.api.timersGet().then((s) => {
      const running = s.active === timerKind && s.running;
      void (running ? window.api.timersPause() : window.api.timersStart(timerKind)).then(
        renderTimers
      );
    });
  });

  el('timer-reset').addEventListener('click', () => {
    void window.api.timersReset(timerKind).then(renderTimers);
  });

  document.querySelectorAll<HTMLButtonElement>('#timer-presets .ghost').forEach((b) => {
    b.addEventListener('click', () => {
      void window.api.timersSetCountdown(Number(b.dataset.secs)).then(renderTimers);
    });
  });

  el('hydration-on').addEventListener('change', () => {
    const on = el<HTMLInputElement>('hydration-on').checked;
    const mins = Number(el<HTMLInputElement>('hydration-mins').value) || 60;
    void window.api.timersSetHydration(on, mins).then(renderTimers);
  });

  let hydrationDebounce: ReturnType<typeof setTimeout> | null = null;
  el('hydration-mins').addEventListener('input', () => {
    if (hydrationDebounce) clearTimeout(hydrationDebounce);
    hydrationDebounce = setTimeout(() => {
      const mins = Math.max(5, Number(el<HTMLInputElement>('hydration-mins').value) || 60);
      const on = el<HTMLInputElement>('hydration-on').checked;
      void window.api.timersSetHydration(on, mins).then(renderTimers);
    }, 500);
  });

  window.api.onTimersTick((state) => {
    if (activeTab === 'timers') renderTimers(state);
  });
}

/* ---------------- stats ---------------- */

function setBar(barId: string, valId: string, percent: number | null, label: string): void {
  el(barId).style.width = percent === null ? '0%' : `${Math.max(0, Math.min(100, percent))}%`;
  el(valId).textContent = label;
}

function renderStats(s: AppStatsSnapshot): void {
  setBar('stat-cpu-bar', 'stat-cpu-val', s.cpuPercent, s.cpuPercent === null ? '—' : `${s.cpuPercent.toFixed(0)}%`);
  setBar('stat-mem-bar', 'stat-mem-val', s.memPercent, `${s.memPercent.toFixed(0)}%`);

  if (s.disk) setBar('stat-disk-bar', 'stat-disk-val', s.disk.percent, `${s.disk.percent.toFixed(0)}%`);
  else setBar('stat-disk-bar', 'stat-disk-val', null, 'n/a');

  if (s.battery) {
    setBar(
      'stat-batt-bar',
      'stat-batt-val',
      s.battery.percent,
      `${s.battery.percent}%${s.battery.charging ? ' · charging' : ''}`
    );
  } else {
    setBar('stat-batt-bar', 'stat-batt-val', null, 'n/a');
  }

  el('stat-net-val').textContent = s.network
    ? `↓ ${formatBytes(s.network.downBytesPerSec)}/s  ↑ ${formatBytes(s.network.upBytesPerSec)}/s`
    : '—';
}

/* ---------------- calendar ---------------- */

function fmtEventWhen(ts: number, allDay: boolean): string {
  if (allDay) return 'All day';
  return new Date(ts).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function renderCalendar(agenda: AppCalendarAgenda): void {
  const events = el('cal-events');
  const reminders = el('cal-reminders');
  const empty = el('cal-empty');

  if (!agenda.ok) {
    events.replaceChildren();
    reminders.replaceChildren();
    empty.hidden = false;
    empty.textContent =
      agenda.error === 'macOS only' ? 'Calendar is macOS only.' : `Couldn't read Calendar: ${agenda.error}`;
    return;
  }
  if (!agenda.events.length && !agenda.reminders.length) {
    events.replaceChildren();
    reminders.replaceChildren();
    empty.hidden = false;
    empty.textContent = 'Nothing in the next 7 days.';
    return;
  }
  empty.hidden = true;

  events.replaceChildren(
    ...agenda.events.map((e) => {
      const li = document.createElement('li');
      li.className = 'cal-item';
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = fmtEventWhen(e.start, e.allDay);
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = e.title;
      li.append(when, title);
      return li;
    })
  );

  reminders.replaceChildren(
    ...agenda.reminders.map((r) => {
      const li = document.createElement('li');
      li.className = 'cal-item reminder';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => {
        li.classList.toggle('done', cb.checked);
        void window.api.calendarCompleteReminder(r.id).then((ok) => {
          if (!ok) {
            cb.checked = false;
            li.classList.remove('done');
          }
        });
      });
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = r.title;
      li.append(cb, title);
      return li;
    })
  );
}

async function loadCalendar(): Promise<void> {
  renderCalendar(await window.api.calendarAgenda(7));
}

/* ---------------- home ---------------- */

/**
 * No state of its own: everything shown here is already tracked by another
 * tab (now playing by the strip, the next reminder by the foot bar), so this
 * just reads those instead of asking main for anything a second time.
 */
function renderHome(): void {
  const nowRow = el('home-now');
  nowRow.hidden = !playing;
  el('home-now-track').textContent = playing ? trackLine(playing) : '';
  el('home-next-val').textContent = el('next').textContent || 'Nothing scheduled';
}

function bindHome(): void {
  document.querySelectorAll<HTMLButtonElement>('.home-launch [data-go]').forEach((b) => {
    b.addEventListener('click', () => setActiveTab(b.dataset.go as TabId));
  });
  el('home-open').addEventListener('click', () => void window.api.showWindow());
}

/* ---------------- scratchpad ---------------- */

function applyScratchState(s: AppScratchpadState): void {
  const box = el<HTMLTextAreaElement>('scratch-text');
  // Never stomp on what's mid-keystroke -- a save that lands while typing
  // would otherwise yank the cursor back to wherever it last saved from.
  if (document.activeElement !== box) box.value = s.text;
  el<HTMLInputElement>('scratch-pin').checked = s.pinned;
  pinnedScratchText = s.pinned && s.text.trim() ? s.text.trim().split('\n')[0].slice(0, 60) : null;
  renderStrip();
}

async function loadScratchpad(): Promise<void> {
  applyScratchState(await window.api.scratchpadGet());
}

function bindScratchpad(): void {
  let debounce: ReturnType<typeof setTimeout> | null = null;
  el('scratch-text').addEventListener('input', () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      void window.api
        .scratchpadSet(el<HTMLTextAreaElement>('scratch-text').value)
        .then(applyScratchState);
    }, 400);
  });
  el('scratch-pin').addEventListener('change', () => {
    void window.api
      .scratchpadPin(el<HTMLInputElement>('scratch-pin').checked)
      .then(applyScratchState);
  });
}

/* ---------------- notes ---------------- */

let openNoteId: string | null = null;
let noteSaveDebounce: ReturnType<typeof setTimeout> | null = null;

function renderNotesList(items: AppNoteItem[]): void {
  const list = el('notes-list');
  const empty = el('notes-empty');
  const main = el('notes-main');

  if (openNoteId && !items.some((n) => n.id === openNoteId)) openNoteId = null;
  if (!openNoteId && items.length) openNoteId = items[0].id;

  empty.hidden = items.length > 0;
  main.hidden = items.length === 0;

  list.replaceChildren(
    ...items.map((n) => {
      const li = document.createElement('li');
      li.className = `note-item${n.id === openNoteId ? ' on' : ''}`;
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = n.title || 'Untitled';
      const snippet = document.createElement('div');
      snippet.className = 'snippet';
      snippet.textContent = n.body.split('\n')[0];
      li.append(title, snippet);
      li.addEventListener('click', () => {
        openNoteId = n.id;
        renderNotesList(items);
        openNote(n);
      });
      return li;
    })
  );

  const current = items.find((n) => n.id === openNoteId);
  if (current && document.activeElement !== el('note-title') && document.activeElement !== el('note-body')) {
    openNote(current);
  }
}

function openNote(n: AppNoteItem): void {
  el<HTMLInputElement>('note-title').value = n.title;
  el<HTMLTextAreaElement>('note-body').value = n.body;
}

async function loadNotes(): Promise<void> {
  renderNotesList(await window.api.notesList());
}

function bindNotes(): void {
  el('note-new').addEventListener('click', () => {
    void window.api.notesCreate().then((items) => {
      openNoteId = items[0]?.id ?? null;
      renderNotesList(items);
    });
  });

  const saveOpenNote = (): void => {
    if (!openNoteId) return;
    if (noteSaveDebounce) clearTimeout(noteSaveDebounce);
    noteSaveDebounce = setTimeout(() => {
      if (!openNoteId) return;
      void window.api
        .notesUpdate(openNoteId, {
          title: el<HTMLInputElement>('note-title').value,
          body: el<HTMLTextAreaElement>('note-body').value,
        })
        // renderNotesList only repaints the editor from fresh data when
        // neither of its fields has focus, so this is safe to call while
        // still typing -- it refreshes the sidebar without touching the cursor.
        .then((items) => renderNotesList(items));
    }, 350);
  };

  el('note-title').addEventListener('input', saveOpenNote);
  el('note-body').addEventListener('input', saveOpenNote);

  el('note-delete').addEventListener('click', () => {
    if (!openNoteId) return;
    const id = openNoteId;
    openNoteId = null;
    void window.api.notesRemove(id).then(renderNotesList);
  });
}

/* ---------------- weather ---------------- */

/** WMO weather codes, collapsed to the handful of labels worth showing. */
function wxLabel(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Unknown';
}

function renderWeather(w: AppWeatherSnapshot): void {
  const days = el('wx-days');
  const empty = el('wx-empty');

  if (!w.location) {
    el('wx-temp').textContent = '—';
    el('wx-cond').textContent = 'Set a location';
    el('wx-loc').textContent = '';
    days.replaceChildren();
    empty.hidden = false;
    empty.textContent = 'Type a city above and hit Set.';
    return;
  }

  el('wx-loc').textContent = w.location.name;

  if (!w.ok && !w.current) {
    el('wx-temp').textContent = '—';
    el('wx-cond').textContent = "Couldn't load";
    days.replaceChildren();
    empty.hidden = false;
    empty.textContent = w.error ?? 'Something went wrong.';
    return;
  }
  empty.hidden = true;

  el('wx-temp').textContent = w.current ? `${Math.round(w.current.temp)}°` : '—';
  el('wx-cond').textContent = w.current ? wxLabel(w.current.code) : '';

  days.replaceChildren(
    ...w.daily.map((day) => {
      const li = document.createElement('li');
      li.className = 'wx-day';
      const d = document.createElement('span');
      d.className = 'd';
      d.textContent = new Date(day.date).toLocaleDateString([], { weekday: 'short' });
      const c = document.createElement('span');
      c.className = 'c';
      c.textContent = wxLabel(day.code);
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = `${Math.round(day.max)}° / ${Math.round(day.min)}°`;
      li.append(d, c, t);
      return li;
    })
  );
}

async function loadWeather(): Promise<void> {
  renderWeather(await window.api.weatherGet());
}

function bindWeather(): void {
  el('wx-set').addEventListener('click', () => {
    const q = el<HTMLInputElement>('wx-q').value.trim();
    if (!q) return;
    void window.api.weatherSetLocation(q).then(renderWeather);
  });
  el('wx-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el('wx-set').click();
  });
}

/* ---------------- message ---------------- */

function bindMessage(): void {
  const run = (): void => {
    const text = el<HTMLInputElement>('msg-text').value.trim();
    if (!text) return;
    void window.api.runMessage(text);
    el<HTMLInputElement>('msg-text').value = '';
  };
  el('msg-run').addEventListener('click', run);
  el('msg-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') run();
  });
}

/* ---------------- tab switching ---------------- */

/** What has to happen once, the moment a tab becomes visible. */
function onTabShown(tab: TabId): void {
  if (tab === 'home') renderHome();
  else if (tab === 'clipboard') void loadClipboard();
  else if (tab === 'shelf') void loadShelf();
  else if (tab === 'notes') void loadNotes();
  else if (tab === 'scratchpad') void loadScratchpad();
  else if (tab === 'timers') void loadTimers();
  else if (tab === 'stats') void window.api.statsSubscribe().then(renderStats);
  else if (tab === 'calendar') void loadCalendar();
  else if (tab === 'weather') void loadWeather();
}

/** Stats sampling costs a handful of external commands per tick, so it only
 *  runs while its tab is actually the one showing. */
function onTabHidden(tab: TabId): void {
  if (tab === 'stats') void window.api.statsUnsubscribe();
}

function setActiveTab(tab: TabId): void {
  if (activeTab === tab) return;
  onTabHidden(activeTab);
  activeTab = tab;
  for (const id of TAB_IDS) el(`view-${id}`).hidden = id !== tab;
  document
    .querySelectorAll<HTMLButtonElement>('.rail-btn')
    .forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  onTabShown(tab);
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
    if (activeTab === 'search') el('q').focus();
    else onTabShown(activeTab); // refreshes data and, for stats, resubscribes
  } else {
    const q = el<HTMLInputElement>('q');
    q.value = '';
    q.blur();
    renderNotchHits([], '');
    // Sampling stats costs real work per tick; never leave it running behind
    // a closed panel just because Stats happened to be the tab left open.
    if (activeTab === 'stats') void window.api.statsUnsubscribe();
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
 * What the closed strip shows, in priority order: a transient system pulse,
 * a message run on purpose, work in progress, what is playing, and last, a
 * scratchpad someone chose to pin. Each one only shows if nothing higher is
 * currently true, so the things that can claim the strip never end up
 * half-applied between them.
 *
 * Work in progress outranks what is playing, because one of them ends and
 * the other is ambient -- and because the hairline is filling for it either
 * way, so a strip still talking about a track would be labelling the wrong
 * thing.
 */
function renderStrip(): void {
  const body = document.body;
  const pulsing = pulseLabel !== null;
  const messaging = !pulsing && messageLabel !== null;
  const showBusy = !pulsing && !messaging && busy?.label != null;
  const showPlaying = !pulsing && !messaging && !showBusy && playing !== null;
  const showScratch = !pulsing && !messaging && !showBusy && !showPlaying && pinnedScratchText !== null;

  body.classList.toggle('pulsing', pulsing);
  body.classList.toggle('messaging', messaging);
  body.classList.toggle('busy', showBusy);
  body.classList.toggle('playing', showPlaying || showScratch);

  el('lip-text').textContent = pulsing
    ? pulseLabel!
    : messaging
      ? messageLabel!
      : showBusy
        ? busy!.label!
        : showPlaying
          ? trackLine(playing!)
          : showScratch
            ? pinnedScratchText!
            : '';

  // The hairline is the progress track: it is already drawn around the whole
  // silhouette, so filling part of it costs no new geometry.
  document.documentElement.style.setProperty('--progress', `${busy ? busy.pct : 0}%`);

  // The icon belongs to what is playing, so a capture's pulse, a download and
  // a pinned scratchpad all borrow the dot instead: none of them is the
  // player talking.
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

/** Runs a message across the collapsed strip for exactly the duration main computed. */
function showMessage(text: string, durationMs: number): void {
  messageLabel = text;
  document.documentElement.style.setProperty('--marquee-duration', `${durationMs}ms`);
  renderStrip();
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    messageLabel = null;
    renderStrip();
  }, durationMs);
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
      if (activeTab === 'shelf') {
        void window.api.shelfAdd(paths).then((items) => {
          renderShelf(items);
          pulse(`${paths.length > 1 ? paths.length + ' files' : 'File'} shelved`);
        });
      } else {
        void window.api.rememberFiles(paths).then((n) => pulse(`${n} remembered`));
      }
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

  document.querySelectorAll<HTMLButtonElement>('#rail .rail-btn').forEach((b) => {
    b.addEventListener('click', () => setActiveTab(b.dataset.tab as TabId));
  });

  let clipDebounce: ReturnType<typeof setTimeout> | null = null;
  el('clip-q').addEventListener('input', () => {
    if (clipDebounce) clearTimeout(clipDebounce);
    clipDebounce = setTimeout(() => void loadClipboard(el<HTMLInputElement>('clip-q').value.trim()), 150);
  });
  el('clip-clear').addEventListener('click', () => {
    void window.api.clipboardClear().then((rows) => renderClipboard(rows, ''));
  });

  el('cal-refresh').addEventListener('click', () => void loadCalendar());

  bindTimers();
  bindHome();
  bindScratchpad();
  bindNotes();
  bindWeather();
  bindMessage();

  window.api.onNotchMessage(({ text, durationMs }) => showMessage(text, durationMs));

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
  window.api.onStatsTick((s) => {
    if (activeTab === 'stats') renderStats(s);
  });
}

void (async function init(): Promise<void> {
  bindNotch();
  // The shape has to exist before the first transition, or the panel's
  // first open animates from no clip at all, which is a full-screen black
  // rectangle collapsing into a notch.
  applyShape();
  paint(await window.api.getState());
  // A pinned scratchpad has to show on the strip from launch, not only after
  // the Scratchpad tab has been opened once this session.
  void loadScratchpad();
  renderHome();
})();
