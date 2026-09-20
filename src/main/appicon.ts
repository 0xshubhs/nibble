import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';

/**
 * The icon of a running macOS app, as a data URL.
 *
 * This exists so the notch can show a small circle of whatever is making
 * noise. The obvious API for it, `app.getFileIcon`, returns a blank generic
 * document icon for every bundle on macOS 27 -- Firefox, Music and this app
 * itself all come back as the same 32px placeholder, byte for byte. So the
 * icon is read the long way instead: find the bundle's .icns and let `sips`
 * rasterise it, which takes about 50ms and is a tool that ships with the OS.
 *
 * Nothing here launches or talks to the app it is describing. It reads a
 * plist and an image file off disk, which needs no automation permission and
 * cannot make a player start.
 */

const run = promisify(execFile);
const TIMEOUT_MS = 2_000;

/** The circle is drawn at 18pt; this is comfortably past it at 2x. */
const ICON_PX = 48;

/**
 * Keyed by bundle, and holding the promise rather than the result, so that
 * two callers arriving during the same poll share one `sips`. Failures are
 * cached too: an app with no readable icon should be asked about once, not
 * every eight seconds for the rest of the session.
 */
const icons = new Map<string, Promise<string>>();

/** The .app bundle an executable path sits inside, if it sits inside one. */
export function bundleOf(execPath: string): string | null {
  const at = execPath.indexOf('.app/');
  return at === -1 ? null : execPath.slice(0, at + 4);
}

/** The bundle a running process belongs to. */
export async function bundleForPid(pid: number): Promise<string | null> {
  try {
    const { stdout } = await run('ps', ['-p', String(pid), '-o', 'comm='], {
      timeout: TIMEOUT_MS,
      encoding: 'utf8',
    });
    return bundleOf(stdout.trim());
  } catch {
    // The process exited between being listed and being asked about.
    return null;
  }
}

/** A bundle in the usual places, by the name an AppleScript knows it as. */
export function bundleForAppName(name: string): string | null {
  for (const dir of ['/Applications', '/System/Applications']) {
    const p = path.join(dir, `${name}.app`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * The bundle's icon file, given whatever CFBundleIconFile said.
 *
 * That key is the documented answer and is usually right, but it is written
 * inconsistently -- Firefox says `firefox.icns`, Music says `AppIcon` with no
 * extension -- and some bundles omit it altogether. Hence the two fallbacks,
 * ending with whatever .icns is actually in there.
 */
function resolveIcns(bundle: string, named: string): string | null {
  const dir = path.join(bundle, 'Contents', 'Resources');

  const tries = [];
  if (named) tries.push(named.endsWith('.icns') ? named : `${named}.icns`);
  tries.push('AppIcon.icns');
  for (const name of tries) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }

  try {
    const any = fs.readdirSync(dir).find((f) => f.endsWith('.icns'));
    return any ? path.join(dir, any) : null;
  } catch {
    return null;
  }
}

/** Where sips is told to put its output for a given bundle. */
function tmpFor(bundle: string): string {
  // Derived from the bundle rather than random, so a crash leaves one stale
  // file per app instead of one per poll.
  return path.join(
    os.tmpdir(),
    `nibble-icon-${crypto.createHash('sha1').update(bundle).digest('hex').slice(0, 12)}.png`
  );
}

const SIPS_ARGS = (icns: string, out: string): string[] => [
  '-s', 'format', 'png',
  '--resampleHeightWidth', String(ICON_PX), String(ICON_PX),
  icns,
  '--out', out,
];

async function icnsPath(bundle: string): Promise<string | null> {
  let named = '';
  try {
    const { stdout } = await run(
      'defaults',
      ['read', path.join(bundle, 'Contents', 'Info'), 'CFBundleIconFile'],
      { timeout: TIMEOUT_MS, encoding: 'utf8' }
    );
    named = stdout.trim();
  } catch {
    // No such key, which is not an error: the fallbacks cover it.
  }
  return resolveIcns(bundle, named);
}

/** The icon as a PNG data URL, or '' if the bundle has none to give. */
export function iconFor(bundle: string): Promise<string> {
  const hit = icons.get(bundle);
  if (hit) return hit;

  const pending = (async (): Promise<string> => {
    if (process.platform !== 'darwin') return '';
    const icns = await icnsPath(bundle);
    if (!icns) return '';

    // sips only writes to a file, so this borrows one.
    const tmp = tmpFor(bundle);
    try {
      await run('sips', SIPS_ARGS(icns, tmp), { timeout: TIMEOUT_MS });
      const png = fs.readFileSync(tmp);
      return `data:image/png;base64,${png.toString('base64')}`;
    } catch {
      return '';
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* it was never written */
      }
    }
  })();

  icons.set(bundle, pending);
  return pending;
}

/**
 * The same thing synchronously, for tooling with no event loop to wait on --
 * the screenshot harness builds its fixtures before anything is running.
 *
 * The app itself must never call this. A poll that blocks the main process
 * for the length of two subprocesses is a poll that stutters the UI.
 */
export function iconForSync(bundle: string): string {
  if (process.platform !== 'darwin') return '';

  let named = '';
  try {
    named = execFileSync(
      'defaults',
      ['read', path.join(bundle, 'Contents', 'Info'), 'CFBundleIconFile'],
      { timeout: TIMEOUT_MS, encoding: 'utf8' }
    ).trim();
  } catch {
    /* covered by the fallbacks */
  }

  const icns = resolveIcns(bundle, named);
  if (!icns) return '';

  const tmp = tmpFor(bundle);
  try {
    execFileSync('sips', SIPS_ARGS(icns, tmp), { timeout: TIMEOUT_MS, stdio: 'ignore' });
    return `data:image/png;base64,${fs.readFileSync(tmp).toString('base64')}`;
  } catch {
    return '';
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* it was never written */
    }
  }
}
