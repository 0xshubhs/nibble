import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';

/**
 * "Start when I log in" across three very different mechanisms:
 *
 *   macOS / Windows -> app.setLoginItemSettings (LaunchServices / registry Run key)
 *   Linux           -> an XDG autostart .desktop file in ~/.config/autostart
 *
 * Electron's setLoginItemSettings is a no-op on Linux, hence the manual file.
 */

export const DESKTOP_FILE = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'autostart',
  'nibble.desktop'
);

/** The command that actually relaunches us, AppImage-aware. */
function launchTarget(): string {
  return process.env.APPIMAGE || process.execPath;
}

function linuxSet(enabled: boolean, hidden: boolean): void {
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
    'Comment=An on-device memory your LLM can search',
    `Exec=${exec}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(DESKTOP_FILE), { recursive: true });
  fs.writeFileSync(DESKTOP_FILE, body, { mode: 0o644 });
}

export function isEnabled(): boolean {
  if (process.platform === 'linux') return fs.existsSync(DESKTOP_FILE);
  return app.getLoginItemSettings({ path: launchTarget() }).openAtLogin;
}

export function setEnabled(enabled: boolean, { hidden = true }: { hidden?: boolean } = {}): boolean {
  // A portable build launched from removable media would point the login item
  // at a path that may not exist next boot, but that is the user's call --
  // we just record it faithfully.
  if (process.platform === 'linux') {
    linuxSet(enabled, hidden);
  } else if (process.platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: launchTarget(),
      args: hidden ? ['--hidden'] : [],
    });
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: hidden });
  }
  return isEnabled();
}

/** True when this launch came from the login item rather than the user. */
export function launchedAtLogin(): boolean {
  if (process.argv.includes('--hidden')) return true;
  if (process.platform === 'darwin') {
    return app.getLoginItemSettings().wasOpenedAtLogin === true;
  }
  return false;
}
