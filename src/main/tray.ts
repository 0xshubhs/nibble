import path from 'path';
import { Tray, Menu, nativeImage, app, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { dataPath } from './paths';
import type { Reminder, Settings } from '../types';

const ASSETS = path.join(__dirname, '..', '..', 'assets');

function trayImage(): Electron.NativeImage {
  if (process.platform === 'darwin') {
    // A template image lets macOS recolor it for light/dark menu bars.
    const img = nativeImage.createFromPath(path.join(ASSETS, 'trayTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage
    .createFromPath(path.join(ASSETS, 'tray.png'))
    .resize({ width: 16, height: 16 });
}

function humanTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

export interface TrayStore {
  readonly reminders: Reminder[];
  readonly settings: Settings;
}

export interface TrayHandlers {
  store: TrayStore;
  onShow(id?: string): void;
  onQuit(): void;
  onSnooze(id: string, minutes: number): void;
  onQuickCapture(): void;
}

/**
 * The tray icon is the app's real home: closing the window only hides it, so
 * this menu is how the user gets back in, sees what is coming up, and quits.
 */
export class AppTray {
  private tray: Tray | null;

  constructor(private readonly deps: TrayHandlers) {
    this.tray = new Tray(trayImage());
    this.tray.setToolTip(app.getName());
    // Windows and Linux do not open the context menu on a left click.
    this.tray.on('click', () => this.deps.onShow());
    this.render();
  }

  render(): void {
    if (!this.tray) return;
    const { store } = this.deps;

    const upcoming = store.reminders
      .filter((r) => r.enabled)
      .sort((a, b) => (a.snoozedUntil ?? a.at) - (b.snoozedUntil ?? b.at))
      .slice(0, 5);

    const upcomingItems: MenuItemConstructorOptions[] = upcoming.length
      ? upcoming.map((r) => ({
          label: `${r.title} ,  ${humanTime(r.snoozedUntil ?? r.at)}`,
          submenu: [
            { label: 'Open', click: () => this.deps.onShow(r.id) },
            {
              label: `Snooze ${store.settings.snoozeMinutes} min`,
              click: () => this.deps.onSnooze(r.id, store.settings.snoozeMinutes),
            },
          ],
        }))
      : [{ label: 'Nothing scheduled', enabled: false }];

    const menu = Menu.buildFromTemplate([
      { label: `${app.getName()} ${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      ...upcomingItems,
      { type: 'separator' },
      { label: 'Open window', click: () => this.deps.onShow() },
      { label: 'New reminder…', click: () => this.deps.onShow('new') },
      {
        label: store.settings.quickCaptureEnabled
          ? `Remember the clipboard (${store.settings.quickCaptureShortcut})`
          : 'Remember the clipboard',
        click: () => this.deps.onQuickCapture(),
      },
      { type: 'separator' },
      {
        label: dataPath().portable ? 'Show data folder (portable)' : 'Show data folder',
        click: () => void shell.openPath(dataPath().dir),
      },
      { type: 'separator' },
      { label: 'Quit', click: () => this.deps.onQuit() },
    ]);

    this.tray.setContextMenu(menu);
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
