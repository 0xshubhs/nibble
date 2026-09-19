import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import type { CaptureSource, SourceAvailability, SourceInstance } from '../../types';

/**
 * Remembers what you were playing.
 *
 * The thing this is actually for is the question you cannot answer any other
 * way: what was that track, or that video, that was on while I was working on
 * the thing I now want to find again. Media is a good index into a day
 * precisely because it is incidental -- you did not write it down, and you
 * would never have thought to.
 *
 * Two readers, because the platforms have nothing in common here:
 *
 *   Linux   MPRIS over D-Bus, which every serious player speaks, browsers
 *           included. One `gdbus` call per player returns the playback state
 *           and the metadata together, so a poll is one short-lived process
 *           and no dependency. A YouTube tab shows up as a player with the
 *           video title and the channel as the artist, which is exactly what
 *           you want to be able to search for later.
 *
 *   macOS   AppleScript to Spotify and Music. There is no supported way to
 *           read what a browser is playing: the system-wide Now Playing
 *           information lives behind a private framework, and reading a
 *           browser's tabs instead means asking for automation access to the
 *           browser, which is a far bigger ask than this feature is worth.
 *
 * Windows has an API for exactly this (GlobalSystemMediaTransportControls),
 * and reaching it needs either a native module or a WinRT round trip through
 * PowerShell, so it is not wired up and this says so rather than pretending.
 */

const run = promisify(execFile);

/** Long enough that skipping through a playlist stores nothing. */
const POLL_MS = 8_000;
const MIN_PLAY_MS = 30_000;
const CALL_TIMEOUT_MS = 2_000;

export interface NowPlaying {
  title: string;
  artist: string;
  album: string;
  url: string;
  /** The player it came from, e.g. Spotify or Brave. */
  app: string;
}

/* ============================================================
   GVariant, read by hand

   gdbus prints its replies in GVariant text format, and pulling three
   strings out of one line does not justify a D-Bus binding, which would be
   a compiled dependency per platform and architecture -- the same trade this
   project turned down for the memory store.
   ============================================================ */

/** Reads a single-quoted GVariant string; `i` must be at the opening quote. */
function readString(src: string, i: number): { value: string; end: number } | null {
  if (src[i] !== "'") return null;
  let out = '';
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    // GVariant escapes a quote inside a string, and titles are full of them.
    if (c === '\\') {
      out += src[j + 1] ?? '';
      j++;
      continue;
    }
    if (c === "'") return { value: out, end: j + 1 };
    out += c;
  }
  return null;
}

/**
 * The value of one key, whether it is a plain string, a variant wrapping one,
 * or an array of them. Anything else (numbers, object paths, booleans) is not
 * something this needs, and comes back null.
 */
export function gvarValue(src: string, key: string): string | null {
  const at = src.indexOf(`'${key}':`);
  if (at === -1) return null;

  let i = at + key.length + 3;
  while (i < src.length && (src[i] === ' ' || src[i] === '<')) i++;

  if (src[i] === '[') {
    const parts: string[] = [];
    i++;
    for (;;) {
      while (i < src.length && (src[i] === ' ' || src[i] === ',')) i++;
      if (src[i] !== "'") break;
      const s = readString(src, i);
      if (!s) break;
      if (s.value) parts.push(s.value);
      i = s.end;
    }
    return parts.join(', ');
  }

  if (src[i] === "'") return readString(src, i)?.value ?? null;
  return null;
}

/**
 * One player's `GetAll` reply, or null if it is not playing right now.
 * Paused is deliberately not playing: leaving something paused all afternoon
 * should not put it in your memory.
 */
export function parseMpris(reply: string, app: string): NowPlaying | null {
  if (gvarValue(reply, 'PlaybackStatus') !== 'Playing') return null;
  const title = gvarValue(reply, 'xesam:title') ?? '';
  if (!title.trim()) return null;
  return {
    title: title.trim(),
    artist: (gvarValue(reply, 'xesam:artist') ?? '').trim(),
    album: (gvarValue(reply, 'xesam:album') ?? '').trim(),
    url: (gvarValue(reply, 'xesam:url') ?? '').trim(),
    app,
  };
}

/** `org.mpris.MediaPlayer2.brave.instance9412` -> `Brave`. */
export function playerName(busName: string): string {
  const rest = busName.replace('org.mpris.MediaPlayer2.', '');
  const word = rest.split('.')[0] || rest;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/* ---------------- the readers ---------------- */

async function readLinux(): Promise<NowPlaying | null> {
  const { stdout: names } = await run(
    'gdbus',
    [
      'call',
      '--session',
      '--dest',
      'org.freedesktop.DBus',
      '--object-path',
      '/org/freedesktop/DBus',
      '--method',
      'org.freedesktop.DBus.ListNames',
    ],
    { timeout: CALL_TIMEOUT_MS, encoding: 'utf8' }
  );

  const players = [...names.matchAll(/'(org\.mpris\.MediaPlayer2\.[^']+)'/g)].map((m) => m[1]);

  for (const bus of players) {
    try {
      const { stdout } = await run(
        'gdbus',
        [
          'call',
          '--session',
          '--dest',
          bus,
          '--object-path',
          '/org/mpris/MediaPlayer2',
          '--method',
          'org.freedesktop.DBus.Properties.GetAll',
          'org.mpris.MediaPlayer2.Player',
        ],
        { timeout: CALL_TIMEOUT_MS, encoding: 'utf8' }
      );
      const found = parseMpris(stdout, playerName(bus));
      // First one actually playing wins; with two players going, whichever
      // D-Bus lists first is as good an answer as any.
      if (found) return found;
    } catch {
      // A player that quits between the listing and the query is normal.
    }
  }
  return null;
}

/**
 * Spotify and Music, asked in one script so a poll is one process.
 *
 * `is running` does not launch anything, which matters: polling must never be
 * the reason an app starts.
 *
 * The separator is AppleScript's `linefeed` constant rather than an escape.
 * AppleScript has no \n, and a real newline cannot appear inside one of its
 * string literals, so writing it the obvious way produces a script that does
 * not compile -- on the user's machine, where there is no way to see it.
 */
const MAC_SCRIPT = [
  'if application "Spotify" is running then',
  '  tell application "Spotify"',
  '    if player state is playing then',
  '      return "Spotify" & linefeed & (name of current track) & linefeed &' +
    ' (artist of current track) & linefeed & (album of current track) & linefeed &' +
    ' (spotify url of current track)',
  '    end if',
  '  end tell',
  'end if',
  'if application "Music" is running then',
  '  tell application "Music"',
  '    if player state is playing then',
  '      return "Music" & linefeed & (name of current track) & linefeed &' +
    ' (artist of current track) & linefeed & (album of current track) & linefeed & ""',
  '    end if',
  '  end tell',
  'end if',
  'return ""',
].join('\n');

async function readMac(): Promise<NowPlaying | null> {
  const { stdout } = await run('osascript', ['-e', MAC_SCRIPT], {
    timeout: CALL_TIMEOUT_MS,
    encoding: 'utf8',
  });
  const [app, title, artist, album, url] = stdout.split('\n').map((l) => l.trim());
  if (!app || !title) return null;
  return { title, artist: artist ?? '', album: album ?? '', url: url ?? '', app };
}

function read(): Promise<NowPlaying | null> {
  if (process.platform === 'linux') return readLinux();
  if (process.platform === 'darwin') return readMac();
  return Promise.resolve(null);
}

/* ---------------- the source ---------------- */

/** One line per track, so the same track twice in a row is one memory. */
function keyOf(np: NowPlaying): string {
  return `${np.app}|${np.title}|${np.artist}`.toLowerCase();
}

/**
 * What actually gets stored. Written as a sentence rather than as fields,
 * because it is going into a search index that is half semantic: "the video
 * about X I had on last Tuesday" has to be able to match this.
 */
function describe(np: NowPlaying): string {
  const verb = np.url.includes('youtu') ? 'Watched' : 'Played';
  const by = np.artist ? ` by ${np.artist}` : '';
  const on = np.album ? `, from ${np.album}` : '';
  const where = ` in ${np.app}`;
  const link = np.url ? `\n${np.url}` : '';
  return `${verb} "${np.title}"${by}${on}${where}.${link}`;
}

/**
 * Whether this machine can answer the question at all.
 *
 * Two separate things have to be true, and the cheap one is checked first:
 * there has to be a session bus to talk to, which a headless or sandboxed
 * process may not have, and gdbus has to be installed to talk to it over.
 *
 * The probe is `gdbus help`, not `gdbus --version`: gdbus has no version
 * flag and exits non-zero on one, which is a very convincing way to report
 * that a program you just found on the PATH does not exist.
 *
 * Cached, because availability is read on every render of the sources list
 * and spawning a process for that would be absurd.
 */
let gdbusChecked: boolean | null = null;
function haveGdbus(): boolean {
  if (gdbusChecked !== null) return gdbusChecked;
  if (!process.env.DBUS_SESSION_BUS_ADDRESS) {
    gdbusChecked = false;
    return false;
  }
  try {
    execFileSync('gdbus', ['help'], { stdio: 'ignore', timeout: CALL_TIMEOUT_MS });
    gdbusChecked = true;
  } catch {
    gdbusChecked = false;
  }
  return gdbusChecked;
}

const source: CaptureSource = {
  id: 'media',
  label: 'Now playing',
  description:
    'Remembers what you listen to and watch, with the title, the artist and the link. Only once something has actually been playing for half a minute.',
  platforms: ['darwin', 'linux'],
  permission: null,
  implemented: true,

  available(): SourceAvailability {
    if (process.platform === 'linux') {
      return haveGdbus()
        ? {
            ok: true,
            note: 'Reads any player that speaks MPRIS, browser tabs included.',
          }
        : {
            ok: false,
            reason: process.env.DBUS_SESSION_BUS_ADDRESS
              ? 'gdbus is not installed'
              : 'there is no D-Bus session to read',
            note: process.env.DBUS_SESSION_BUS_ADDRESS
              ? 'gdbus comes with glib. Install glib2 or libglib2.0-bin and turn this on again.'
              : 'Players announce what they are playing over the session bus, and this process cannot see one.',
          };
    }
    return {
      ok: true,
      note: 'Spotify and Music. macOS will ask once for permission to control them; browsers cannot be read without far broader access.',
    };
  },

  create(): SourceInstance {
    let timer: NodeJS.Timeout | null = null;
    let captured = 0;
    let skipped = 0;
    let busy = false;
    let complained = false;

    /** The track being watched, and whether it has played long enough yet. */
    let pending: { key: string; since: number } | null = null;
    const stored = new Set<string>();

    return {
      start(ctx) {
        const tick = async (): Promise<void> => {
          // A slow AppleScript must not stack up behind the next tick.
          if (busy) return;
          busy = true;
          try {
            const np = await read();
            if (!np) {
              pending = null;
              return;
            }

            const key = keyOf(np);
            if (stored.has(key)) return;

            if (!pending || pending.key !== key) {
              pending = { key, since: Date.now() };
              return;
            }
            if (Date.now() - pending.since < MIN_PLAY_MS) return;

            const res = ctx.capture({
              source: 'media',
              kind: 'media',
              text: describe(np),
              title: np.artist ? `${np.title} — ${np.artist}` : np.title,
              meta: { app: np.app, artist: np.artist, album: np.album, path: np.url },
            });
            // Remembered or refused, it is settled: do not ask again about
            // the same track until it comes round again after a restart.
            stored.add(key);
            if (stored.size > 500) stored.delete(stored.values().next().value as string);
            if (res.added) captured++;
            else skipped++;
          } catch (err) {
            // A player quitting mid-call, or automation refused on macOS.
            // Say it once: a poll that logs every eight seconds is noise.
            if (!complained) {
              complained = true;
              ctx.log(
                `media: could not read what is playing (${err instanceof Error ? err.message : String(err)})`
              );
            }
          } finally {
            busy = false;
          }
        };

        void tick();
        timer = setInterval(() => void tick(), POLL_MS);
      },

      stop() {
        if (timer) clearInterval(timer);
        timer = null;
        pending = null;
      },

      state() {
        return { running: timer !== null, captured, skipped };
      },
    };
  },
};

export default source;
