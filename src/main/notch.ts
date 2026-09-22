import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { app, BrowserWindow, powerMonitor, screen } from 'electron';
import type { Display } from 'electron';
import type { Settings } from '../types';

/**
 * The panel that hangs off the MacBook notch.
 *
 * There is no API for any of this. macOS exposes the notch only through
 * NSScreen.safeAreaInsets, which Electron does not surface, so the approach
 * every app in this category uses is the same one here: a borderless,
 * transparent panel pinned to the top centre of the internal display, raised
 * above the menu bar, painted black so it reads as an extension of the
 * physical notch rather than a window near it.
 *
 * Three things make it behave like part of the system rather than an app:
 *
 *   - the window level is 'screen-saver', which is the only level above the
 *     menu bar; anything lower disappears underneath it
 *   - it is visible on every space and over fullscreen apps, or it would
 *     vanish the moment the user switched desktops
 *   - while collapsed it ignores mouse events and forwards them, so the menu
 *     bar underneath stays clickable
 *
 * Hover is detected by polling the cursor rather than by mouse events on the
 * window, because a window that ignores mouse events cannot receive them.
 */

const COLLAPSED_H = 40;
// Wide enough for the icon rail plus the content column beside it -- eleven
// tools live here now, in a sidebar rather than a row of tabs. See notch.html.
const EXPANDED_W = 520;
const EXPANDED_H = 480;

/**
 * Two poll rates, because the two jobs are not the same job.
 *
 * Closed, this is only asking "did the cursor arrive", and a tenth of a
 * second of lag before an animation starts is imperceptible. Open, it is
 * deciding when to take the panel away from under the user's cursor, and
 * being slow there feels like the panel is sticking to them.
 */
const POLL_IDLE_MS = 140;
const POLL_OPEN_MS = 50;

/**
 * Crossing the notch on the way to the menu bar should not open anything, so
 * the cursor has to stay put briefly first; leaving should not snatch the
 * panel away on a wobble, so it lingers.
 */
const HOVER_DELAY_MS = 120;
const LEAVE_DELAY_MS = 300;

/** Once open, the cursor can stray this far outside before it counts as left. */
const LEAVE_MARGIN = 24;

/**
 * A menu bar is never really shorter than this. The reported height comes
 * from the work area, which is briefly wrong right after a resolution change
 * or a wake, and a zero here would put the panel's body over the menu bar.
 */
const MIN_MENUBAR_H = 24;

/** Used only until the real width has been measured, or if measuring fails. */
const ASSUMED_NOTCH_W = 180;

const run = promisify(execFile);

/**
 * The notch's width in points, measured rather than guessed.
 *
 * NSScreen has published this since macOS 12 -- `auxiliaryTopLeftArea` is the
 * usable strip to the left of the notch, so the notch is whatever is left in
 * the middle -- but Electron surfaces neither it nor `safeAreaInsets`. It is
 * reachable anyway through AppleScript's ObjC bridge, which is AppKit in
 * another process rather than a private API, and needs no permission.
 *
 * Guessing instead does not work. The width scales with the display mode, so
 * it is not a constant per machine: this 14" M3 reports 165pt at 1352x878
 * and would report a different number at every other scaled resolution.
 *
 * The screens are walked rather than asking for the main one, because the
 * main screen is whichever holds the key window -- plug in a monitor and it
 * is the one without a notch.
 */
const NOTCH_WIDTH_SCRIPT = [
  'use framework "AppKit"',
  'use scripting additions',
  'repeat with s in (current application\'s NSScreen\'s screens() as list)',
  '  try',
  '    set L to s\'s auxiliaryTopLeftArea()',
  '    set lw to item 1 of item 2 of L',
  '    set w to item 1 of item 2 of (s\'s frame())',
  '    if lw > 0 then return ((w - 2 * lw) as string)',
  '  end try',
  'end repeat',
  'return "0"',
].join('\n');

async function measureNotchWidth(): Promise<number | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await run('osascript', ['-l', 'AppleScript', '-e', NOTCH_WIDTH_SCRIPT], {
      timeout: 4_000,
      encoding: 'utf8',
    });
    const w = Math.round(Number(stdout.trim()));
    // Zero means no screen admitted to having a notch, which is the honest
    // answer on a Mac that does not.
    return Number.isFinite(w) && w > 0 ? w : null;
  } catch {
    return null;
  }
}

/**
 * Whether this Mac probably has a notch.
 *
 * Deliberately a guess. The obvious signal, menu bar height, does not work:
 * a 14" M3 running at a scaled resolution reports a 29pt menu bar while an
 * external 1080p display reports 30pt. So this reads the model identifier
 * instead. Apple switched to the flat "Mac<major>,<minor>" scheme at the same
 * time the notch arrived, and the only notched machine still on the old
 * scheme is the 2021 MacBook Pro.
 */
export function likelyNotched(): boolean {
  if (process.platform !== 'darwin') return false;
  let model = '';
  try {
    model = execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim();
  } catch {
    return false;
  }
  if (/^MacBookPro18,/.test(model)) return true; // 2021 14" and 16"
  const flat = /^Mac(\d+),/.exec(model);
  if (!flat) return false;
  // Mac14,x and later are the notched MacBook generations. Desktops share the
  // scheme, but they have no internal display, which the caller checks.
  return Number(flat[1]) >= 14;
}

/** The built-in display, which is the only one that can have a notch. */
function internalDisplay(): Display | null {
  const all = screen.getAllDisplays();
  return all.find((d) => d.internal) ?? null;
}

export interface NotchDeps {
  settings: () => Settings;
  preload: string;
  page: string;
}

export class NotchPanel {
  private win: BrowserWindow | null = null;
  private timer: NodeJS.Timeout | null = null;
  private expanded = false;
  private display: Display | null = null;
  /** Pending open or close, held while the cursor proves it meant it. */
  private intent: NodeJS.Timeout | null = null;
  /** The measured notch width, once the measurement has come back. */
  private measured: number | null = null;

  constructor(private readonly deps: NotchDeps) {}

  supported(): boolean {
    return process.platform === 'darwin' && internalDisplay() !== null;
  }

  /**
   * The width to treat the notch as.
   *
   * An explicit setting wins, because it exists for the case where the
   * measurement is wrong or somebody simply wants a wider target. Otherwise
   * it is what the OS said, and only failing that a guess.
   */
  private notchWidth(): number {
    const set = this.deps.settings().notchWidth;
    return Math.max(80, set || this.measured || ASSUMED_NOTCH_W);
  }

  /**
   * Asks the OS how wide the notch is and tells the page when it answers.
   *
   * Deliberately not awaited anywhere. It costs about half a second, which
   * is far too long to hold up showing the panel; the panel opens at the
   * assumed width and morphs to the real one when this lands, which is a
   * transition rather than a jump.
   */
  private remeasure(): void {
    void measureNotchWidth().then((w) => {
      if (w === null || w === this.measured) return;
      this.measured = w;
      this.sendGeometry();
    });
  }

  get isOpen(): boolean {
    return this.win !== null && !this.win.isDestroyed();
  }

  start(): boolean {
    if (!this.supported() || this.isOpen) return this.isOpen;

    const display = internalDisplay();
    if (!display) return false;
    this.display = display;

    const { x, y } = this.position(display);

    this.win = new BrowserWindow({
      x,
      y,
      width: EXPANDED_W,
      height: EXPANDED_H,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      // Without this the panel never reaches the notch. AppKit runs every
      // window through constrainFrameRect:toScreen: as it is ordered on
      // screen, which pushes the frame down below the menu bar -- a 460x300
      // panel asked for y=0 comes back at y=29, and setBounds cannot put it
      // back once it is visible. This is the flag that makes Electron skip
      // that constraint, and it has to be set at construction: the window
      // level and the workspace behaviour have no effect on it.
      enableLargerThanScreen: true,
      // An NSPanel floats without activating the app, so clicking it does not
      // pull the user out of whatever they were doing.
      type: 'panel',
      acceptFirstMouse: true,
      // Collapsed, the panel is scenery: it must not be able to take the
      // keyboard from whatever the user is typing in. It becomes focusable
      // only while it is open, which is the only time it has a text field.
      focusable: false,
      show: false,
      webPreferences: {
        preload: this.deps.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });

    void this.win.loadFile(this.deps.page);

    // 'screen-saver' is the only level that sits above the menu bar.
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.setIgnoreMouseEvents(true, { forward: true });

    this.win.once('ready-to-show', () => {
      this.win?.showInactive();
      this.sendGeometry();
      this.send();
    });

    this.win.on('closed', () => {
      this.win = null;
    });

    // Reposition if the user changes resolution or docks a monitor.
    screen.on('display-metrics-changed', this.reposition);
    screen.on('display-added', this.reposition);
    screen.on('display-removed', this.reposition);
    // Waking is the other way the geometry goes stale, and it does not always
    // come with a display event.
    powerMonitor.on('resume', this.reposition);
    powerMonitor.on('unlock-screen', this.reposition);

    this.arm(POLL_IDLE_MS);
    this.remeasure();

    // Development helper: hovering the notch cannot be scripted, so this opens
    // the panel on launch and holds it open for a look.
    if (!app.isPackaged && process.argv.includes('--notch-open')) {
      setTimeout(() => {
        this.setExpanded(true);
        if (this.timer) clearInterval(this.timer);
        this.timer = null;

        const shotArg = process.argv.find((a) => a.startsWith('--screenshot-notch='));
        if (shotArg) {
          const file = shotArg.slice('--screenshot-notch='.length);
          const tabArg = (process.argv.find((a) => a.startsWith('--notch-tab=')) ?? '').slice(12);
          setTimeout(() => {
            void (async () => {
              if (tabArg) {
                await this.win?.webContents.executeJavaScript(
                  `document.querySelector('[data-tab="${tabArg}"]')?.click()`
                );
                await new Promise((r) => setTimeout(r, 400));
              }
              const img = await this.win!.webContents.capturePage();
              (await import('fs')).writeFileSync(file, img.toPNG());
              console.log(`NOTCH_SHOT ${file}`);
            })();
          }, 500);
        }
      }, 900);
    }

    return true;
  }

  private position(display: Display): { x: number; y: number } {
    return {
      x: Math.round(display.bounds.x + (display.bounds.width - EXPANDED_W) / 2),
      y: display.bounds.y,
    };
  }

  private reposition = (): void => {
    const display = internalDisplay();
    if (!display || !this.isOpen) return;
    this.display = display;
    const { x, y } = this.position(display);
    this.win?.setBounds({ x, y, width: EXPANDED_W, height: EXPANDED_H });
    this.sendGeometry();
    // The width is a function of the display mode, so a metrics change
    // invalidates it just as much as the position.
    this.remeasure();
  };

  /**
   * The strip the cursor has to touch to open the panel: the notch itself,
   * plus a little below it so a downward flick still lands.
   */
  private hotZone(): { x: number; y: number; width: number; height: number } | null {
    if (!this.display) return null;
    const width = this.notchWidth();
    return {
      x: Math.round(this.display.bounds.x + (this.display.bounds.width - width) / 2),
      y: this.display.bounds.y,
      width,
      height: COLLAPSED_H,
    };
  }

  /** (Re)starts the cursor poll at the rate the current state wants. */
  private arm(every: number): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.poll(), every);
  }

  /**
   * Schedules a state change the cursor has to hold still for.
   *
   * Both directions are deliberate. Without the open delay, every trip to the
   * menu bar flings the panel out; without the close delay, a hand that
   * wobbles on the way to a button loses the panel mid-reach. Anything that
   * contradicts a pending change cancels it, so a cursor that passes straight
   * through leaves no trace.
   */
  private intend(on: boolean, delay: number): void {
    if (this.expanded === on) {
      this.cancelIntent();
      return;
    }
    if (this.intent) return; // already waiting for exactly this
    this.intent = setTimeout(() => {
      this.intent = null;
      this.setExpanded(on);
    }, delay);
  }

  private cancelIntent(): void {
    if (this.intent) clearTimeout(this.intent);
    this.intent = null;
  }

  private poll(): void {
    if (!this.isOpen) return;
    const p = screen.getCursorScreenPoint();

    if (!this.expanded) {
      const zone = this.hotZone();
      if (!zone) return;
      const inside =
        p.x >= zone.x && p.x <= zone.x + zone.width && p.y >= zone.y && p.y <= zone.y + zone.height;
      if (inside) this.intend(true, HOVER_DELAY_MS);
      else this.cancelIntent();
      return;
    }

    const b = this.win!.getBounds();
    const outside =
      p.x < b.x - LEAVE_MARGIN ||
      p.x > b.x + b.width + LEAVE_MARGIN ||
      p.y < b.y - LEAVE_MARGIN ||
      p.y > b.y + b.height + LEAVE_MARGIN;
    // Keep it open while the user is typing in it.
    if (outside && !this.win!.isFocused()) this.intend(false, LEAVE_DELAY_MS);
    else this.cancelIntent();
  }

  private setExpanded(on: boolean): void {
    if (this.expanded === on || !this.isOpen) return;
    this.expanded = on;
    this.cancelIntent();
    // Collapsed, the panel must not eat clicks meant for the menu bar, and
    // must not be able to take the keyboard either.
    this.win!.setIgnoreMouseEvents(!on, { forward: true });
    this.win!.setFocusable(on);
    this.win!.webContents.send('notch:expanded', on);
    if (!on) this.win!.blur();
    // Track the cursor closely while it is open, idle along while it is not.
    this.arm(on ? POLL_OPEN_MS : POLL_IDLE_MS);
  }

  /**
   * The menu bar height varies with the display's scaling mode (a 14" M3
   * reports 29pt at one resolution and 37pt at another), so the page is told
   * rather than left to assume.
   */
  private sendGeometry(): void {
    if (!this.isOpen || !this.display) return;
    this.win!.webContents.send('notch:geometry', {
      menuBarHeight: Math.max(
        MIN_MENUBAR_H,
        this.display.workArea.y - this.display.bounds.y
      ),
      notchWidth: this.notchWidth(),
    });
  }

  /** Closes the panel from the inside: Escape, or its own close button. */
  collapse(): void {
    this.setExpanded(false);
  }

  /**
   * Pushes whatever the panel should be showing.
   *
   * The channel is the same `state` the main window listens on, because the
   * payload is the same snapshot and the preload exposes exactly one
   * subscription for it. Sending this on a channel of its own is what it used
   * to do, and nothing was listening: the panel painted once at startup and
   * then showed a stale next-reminder and pause state for the rest of the
   * session.
   */
  send(payload?: unknown): void {
    if (!this.isOpen) return;
    this.win!.webContents.send('state', payload ?? null);
  }

  /** A brief visual pulse, for when something is captured. */
  pulse(label: string): void {
    if (!this.isOpen) return;
    this.win!.webContents.send('notch:pulse', label);
  }

  /**
   * A message the user typed themselves, run across the collapsed strip.
   * Separate from `pulse`, which is the app's own brief system feedback --
   * this is deliberate and can run far longer than a two-second pulse, so
   * the renderer needs its own duration to animate against.
   */
  message(text: string, durationMs: number): void {
    if (!this.isOpen) return;
    this.win!.webContents.send('notch:message', { text, durationMs });
  }

  /**
   * A generic push for the tool tabs (timers, stats), which tick on their own
   * clock rather than through the shared `state` snapshot. Dropped silently
   * while the panel doesn't exist, same as `send` and `pulse` -- there is
   * nothing to catch up on the other end when it next opens, because the tool
   * itself is asked for a fresh reading as soon as its tab is shown.
   */
  push(channel: string, payload: unknown): void {
    if (!this.isOpen) return;
    this.win!.webContents.send(channel, payload);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.cancelIntent();
    screen.off('display-metrics-changed', this.reposition);
    screen.off('display-added', this.reposition);
    screen.off('display-removed', this.reposition);
    powerMonitor.off('resume', this.reposition);
    powerMonitor.off('unlock-screen', this.reposition);
    this.expanded = false;
    if (this.isOpen) this.win!.destroy();
    this.win = null;
  }
}

/** Where the notch page and its preload live, relative to the compiled tree. */
export function notchPaths(): { preload: string; page: string } {
  return {
    preload: path.join(__dirname, '..', 'preload.js'),
    page: path.join(__dirname, '..', 'renderer', 'notch.html'),
  };
}
