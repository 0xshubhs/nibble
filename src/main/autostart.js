'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

/**
 * "Start when I log in" across three very different mechanisms:
 *
 *   macOS / Windows -> app.setLoginItemSettings (LaunchServices / registry Run key)
 *   Linux           -> an XDG autostart .desktop file in ~/.config/autostart
 *
 * Electron's setLoginItemSettings is a no-op on Linux, hence the manual file.
 */

const DESKTOP_FILE = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'autostart',
  'nibble.desktop'
);

/** The command that actually relaunches us, AppImage-aware. */
function launchTarget() {
  if (process.env.APPIMAGE) return process.env.APPIMAGE;
  return process.execPath;
}

function linuxSet(enabled, { hidden }) {
  if (!enabled) {
    fs.rmSync(DESKTOP_FILE, { force: true });
    return;
  }
  const exec = `"${launchTarget()}"${hidden ? ' --hidden' : ''}`;
  const body = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${app.getName()}`,
    'Comment=Reminders that keep running in the background',
    `Exec=${exec}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(DESKTOP_FILE), { recursive: true });
  fs.writeFileSync(DESKTOP_FILE, body, { mode: 0o644 });
}

function isEnabled() {
  if (process.platform === 'linux') return fs.existsSync(DESKTOP_FILE);
  return app.getLoginItemSettings({ path: launchTarget() }).openAtLogin;
}

function setEnabled(enabled, { hidden = true } = {}) {
  // A portable build launched from removable media would point the login item
  // at a path that may not exist next boot, but that is the user's call --
  // we just record it faithfully.
  if (process.platform === 'linux') {
    linuxSet(enabled, { hidden });
  } else if (process.platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: launchTarget(),
      args: hidden ? ['--hidden'] : [],
    });
  } else {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: hidden,
    });
  }
  return isEnabled();
}

/** True when this launch came from the login item rather than the user. */
function launchedAtLogin() {
  if (process.argv.includes('--hidden')) return true;
  if (process.platform === 'darwin') {
    return app.getLoginItemSettings().wasOpenedAtLogin === true;
  }
  return false;
}

module.exports = { isEnabled, setEnabled, launchedAtLogin, DESKTOP_FILE };
