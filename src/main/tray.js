'use strict';
const path = require('path');
const { Tray, Menu, nativeImage, app, shell } = require('electron');
const { dataPath } = require('./paths');

const ASSETS = path.join(__dirname, '..', '..', 'assets');

function trayImage() {
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

function humanTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

/**
 * The tray icon is the app's real home: closing the window only hides it, so
 * this menu is how the user gets back in, sees what is coming up, and quits.
 */
class AppTray {
  constructor({ store, onShow, onQuit, onSnooze }) {
    this.store = store;
    this.onShow = onShow;
    this.onQuit = onQuit;
    this.onSnooze = onSnooze;
    this.tray = new Tray(trayImage());
    this.tray.setToolTip(app.getName());
    // Windows and Linux do not open the context menu on a left click.
    this.tray.on('click', () => this.onShow());
    this.render();
  }

  render() {
    const upcoming = this.store.reminders
      .filter((r) => r.enabled)
      .sort((a, b) => (a.snoozedUntil || a.at) - (b.snoozedUntil || b.at))
      .slice(0, 5);

    const upcomingItems = upcoming.length
      ? upcoming.map((r) => ({
          label: `${r.title}  —  ${humanTime(r.snoozedUntil || r.at)}`,
          submenu: [
            { label: 'Open', click: () => this.onShow(r.id) },
            {
              label: `Snooze ${this.store.settings.snoozeMinutes} min`,
              click: () => this.onSnooze(r.id, this.store.settings.snoozeMinutes),
            },
          ],
        }))
      : [{ label: 'Nothing scheduled', enabled: false }];

    const menu = Menu.buildFromTemplate([
      { label: `${app.getName()} ${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      ...upcomingItems,
      { type: 'separator' },
      { label: 'Open window', click: () => this.onShow() },
      { label: 'New reminder…', click: () => this.onShow('new') },
      { type: 'separator' },
      {
        label: dataPath().portable ? 'Show data folder (portable)' : 'Show data folder',
        click: () => shell.openPath(dataPath().dir),
      },
      { type: 'separator' },
      { label: 'Quit', click: () => this.onQuit() },
    ]);

    this.tray.setContextMenu(menu);
  }

  destroy() {
    this.tray?.destroy();
    this.tray = null;
  }
}

module.exports = { AppTray };
