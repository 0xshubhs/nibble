import path from 'path';
import { BrowserWindow, screen } from 'electron';
import { GlobalHotkey } from './hotkey';
import type { RecallState } from '../types';

/**
 * The read side of quick capture: a second global hotkey that opens a small
 * floating search box, wherever you are, on any platform -- not only the
 * notch's Mac-only hover. One keystroke stores something; this one finds it
 * again, and hands the query off to the main window rather than growing its
 * own results browser.
 */

export const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+K';

const WIDTH = 560;
const HEIGHT = 420;

export interface RecallDeps {
  preload: string;
  page: string;
}

export class RecallOverlay {
  private readonly hotkey: GlobalHotkey;
  private win: BrowserWindow | null = null;

  constructor(private readonly deps: RecallDeps) {
    this.hotkey = new GlobalHotkey(DEFAULT_SHORTCUT, () => this.toggle());
  }

  /** Idempotent: re-registers the hotkey only when the setting or key changed. */
  apply(enabled: boolean, accelerator: string): RecallState {
    const state = this.hotkey.apply(enabled, accelerator);
    if (!enabled) this.hide();
    return state;
  }

  get isOpen(): boolean {
    return this.win !== null && !this.win.isDestroyed() && this.win.isVisible();
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;

    this.win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: this.deps.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    void this.win.loadFile(this.deps.page);
    // Same level as the notch panel, so it can float above a fullscreen app
    // too -- a launcher that only worked over the desktop would be a trap.
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Losing focus is dismissal, the same as clicking outside a real
    // launcher -- not something that needs an explicit close.
    this.win.on('blur', () => this.hide());
    this.win.on('closed', () => {
      this.win = null;
    });

    return this.win;
  }

  toggle(): void {
    if (this.isOpen) this.hide();
    else this.show();
  }

  show(): void {
    const win = this.ensureWindow();

    // Centred on whichever display the cursor is actually on, not always the
    // primary one -- summoning it should not teleport the search box to a
    // monitor you are not looking at.
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const x = Math.round(display.bounds.x + (display.bounds.width - WIDTH) / 2);
    // A third of the way down, like a launcher, not a dialog box dead
    // centred on the screen.
    const y = Math.round(display.bounds.y + display.bounds.height * 0.22);
    win.setBounds({ x, y, width: WIDTH, height: HEIGHT });

    win.show();
    win.focus();
    // Tells the page to clear whatever was typed last time and refocus the
    // input -- reused rather than recreated, so reopening is instant.
    win.webContents.send('recall:shown');
  }

  hide(): void {
    if (!this.win || this.win.isDestroyed() || !this.win.isVisible()) return;
    this.win.hide();
  }

  stop(): void {
    this.hotkey.stop();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  state(): RecallState {
    return this.hotkey.state();
  }
}

/** Where the recall page lives, relative to the compiled tree. */
export function recallPaths(): { preload: string; page: string } {
  return {
    preload: path.join(__dirname, '..', 'preload.js'),
    page: path.join(__dirname, '..', 'renderer', 'recall.html'),
  };
}
