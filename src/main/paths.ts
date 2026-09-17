import path from 'path';
import fs from 'fs';
import { app } from 'electron';

/**
 * Portable mode: keep every byte the app writes next to the executable
 * instead of in the OS profile directory, so the whole thing travels on a
 * USB stick and leaves nothing behind.
 *
 * It turns on when any of these is true:
 *   - the app was launched with --portable
 *   - electron-builder's Windows `portable` target set PORTABLE_EXECUTABLE_DIR
 *   - we are running from a Linux AppImage
 *   - a file named `portable` sits next to the executable
 *
 * macOS .app bundles live in read-only places often enough (and /Applications
 * needs admin) that we only honour portable mode there when the directory is
 * actually writable, falling back to the normal userData path if it is not.
 */

const FOLDER = 'nibble-data';

export interface DataPath {
  dir: string;
  portable: boolean;
}

function candidateDir(): string {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }
  if (process.env.APPIMAGE) {
    return path.dirname(process.env.APPIMAGE);
  }
  if (app.isPackaged) {
    // .../Foo.app/Contents/MacOS/Foo -> .../  (beside the bundle)
    if (process.platform === 'darwin') {
      return path.resolve(path.dirname(process.execPath), '..', '..', '..');
    }
    return path.dirname(process.execPath);
  }
  return path.join(__dirname, '..', '..');
}

function isWritable(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

let resolved: DataPath | null = null;

/** Decides where data lives. Must be called before `app.whenReady()`. */
export function initDataPath(): DataPath {
  if (resolved) return resolved;

  const asked =
    process.argv.includes('--portable') ||
    Boolean(process.env.PORTABLE_EXECUTABLE_DIR) ||
    Boolean(process.env.APPIMAGE);

  const base = candidateDir();
  const marker = (() => {
    try {
      return fs.existsSync(path.join(base, 'portable'));
    } catch {
      return false;
    }
  })();

  if ((asked || marker) && isWritable(base)) {
    const dir = path.join(base, FOLDER);
    fs.mkdirSync(dir, { recursive: true });
    app.setPath('userData', dir);
    // Keep the cache inside the portable folder too, or Chromium scatters it.
    app.setPath('sessionData', dir);
    resolved = { dir, portable: true };
  } else {
    resolved = { dir: app.getPath('userData'), portable: false };
  }
  return resolved;
}

export function dataPath(): DataPath {
  return resolved ?? { dir: app.getPath('userData'), portable: false };
}
