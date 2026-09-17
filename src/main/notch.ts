import path from 'path';
import { execFileSync } from 'child_process';
import { app, BrowserWindow, screen } from 'electron';
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
const EXPANDED_W = 460;
const EXPANDED_H = 300;
const POLL_MS = 120;
/** Once open, the cursor can stray this far outside before it closes. */
const LEAVE_MARGIN = 24;

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

  constructor(private readonly deps: NotchDeps) {}

  supported(): boolean {
    return process.platform === 'darwin' && internalDisplay() !== null;
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
      // An NSPanel floats without activating the app, so clicking it does not
      // pull the user out of whatever they were doing.
      type: 'panel',
      acceptFirstMouse: true,
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

    this.timer = setInterval(() => this.poll(), POLL_MS);

    // Development helper: hovering the notch cannot be scripted, so this opens
    // the panel on launch and holds it open for a look.
    if (!app.isPackaged && process.argv.includes('--notch-open')) {
      setTimeout(() => {
        this.setExpanded(true);
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
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
  };

  /**
   * The strip the cursor has to touch to open the panel: the notch itself,
   * plus a little below it so a downward flick still lands.
   */
  private hotZone(): { x: number; y: number; width: number; height: number } | null {
    if (!this.display) return null;
    const width = Math.max(80, this.deps.settings().notchWidth || 200);
    return {
      x: Math.round(this.display.bounds.x + (this.display.bounds.width - width) / 2),
      y: this.display.bounds.y,
      width,
      height: COLLAPSED_H,
    };
  }

  private poll(): void {
    if (!this.isOpen) return;
    const p = screen.getCursorScreenPoint();

    if (!this.expanded) {
      const zone = this.hotZone();
      if (!zone) return;
      const inside =
        p.x >= zone.x && p.x <= zone.x + zone.width && p.y >= zone.y && p.y <= zone.y + zone.height;
      if (inside) this.setExpanded(true);
      return;
    }

    const b = this.win!.getBounds();
    const outside =
      p.x < b.x - LEAVE_MARGIN ||
      p.x > b.x + b.width + LEAVE_MARGIN ||
      p.y < b.y - LEAVE_MARGIN ||
      p.y > b.y + b.height + LEAVE_MARGIN;
    // Keep it open while the user is typing in it.
    if (outside && !this.win!.isFocused()) this.setExpanded(false);
  }

  private setExpanded(on: boolean): void {
    if (this.expanded === on || !this.isOpen) return;
    this.expanded = on;
    // Collapsed, the panel must not eat clicks meant for the menu bar.
    this.win!.setIgnoreMouseEvents(!on, { forward: true });
    this.win!.webContents.send('notch:expanded', on);
    if (!on) this.win!.blur();
  }

  /**
   * The menu bar height varies with the display's scaling mode (a 14" M3
   * reports 29pt at one resolution and 37pt at another), so the page is told
   * rather than left to assume.
   */
  private sendGeometry(): void {
    if (!this.isOpen || !this.display) return;
    this.win!.webContents.send('notch:geometry', {
      menuBarHeight: this.display.workArea.y - this.display.bounds.y,
      notchWidth: Math.max(80, this.deps.settings().notchWidth || 200),
    });
  }

  /** Pushes whatever the panel should be showing. */
  send(payload?: unknown): void {
    if (!this.isOpen) return;
    this.win!.webContents.send('notch:state', payload ?? null);
  }

  /** A brief visual pulse, for when something is captured. */
  pulse(label: string): void {
    if (!this.isOpen) return;
    this.win!.webContents.send('notch:pulse', label);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    screen.off('display-metrics-changed', this.reposition);
    screen.off('display-added', this.reposition);
    screen.off('display-removed', this.reposition);
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
