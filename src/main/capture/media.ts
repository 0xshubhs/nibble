import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { bundleForAppName, bundleForPid, iconFor } from '../appicon';
import type {
  CaptureContext,
  CaptureSource,
  NowPlaying,
  SourceAvailability,
  SourceInstance,
} from '../../types';

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
 *   macOS   AppleScript to Spotify and Music, and `pmset` for everything
 *           else. The system-wide Now Playing information lives behind a
 *           private framework and a browser's tabs need automation access to
 *           that browser, so neither is on the table -- but an app playing
 *           audio takes out a power assertion to stop the machine sleeping
 *           under it, and `pmset -g assertions` lists those by pid. That
 *           cannot say what a YouTube tab is playing, only that Firefox is
 *           playing something, which is enough to show the source in the
 *           notch and is not enough to write down.
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

/**
 * Whichever app is holding the "audio-playing" assertion.
 *
 * Only that assertion is read, deliberately. coreaudiod publishes its own
 * entries naming the pid on each end of a stream, but they include things
 * like the speech daemon holding an input open -- a machine sitting idle
 * lists two of them. The `audio-playing` assertion is the one an app takes
 * out because it is actually playing something to the user.
 */
const AUDIO_ASSERTION = /\bpid (\d+)\([^)]*\):.*?named:\s*"audio-playing"/;

async function readMacAudioApp(): Promise<NowPlaying | null> {
  const { stdout } = await run('pmset', ['-g', 'assertions'], {
    timeout: CALL_TIMEOUT_MS,
    encoding: 'utf8',
  });

  for (const line of stdout.split('\n')) {
    const m = AUDIO_ASSERTION.exec(line);
    if (!m) continue;
    const bundle = await bundleForPid(Number(m[1]));
    if (!bundle) continue;
    return {
      title: '',
      artist: '',
      album: '',
      url: '',
      app: path.basename(bundle, '.app'),
      icon: await iconFor(bundle),
    };
  }
  return null;
}

async function readMac(): Promise<NowPlaying | null> {
  const { stdout } = await run('osascript', ['-e', MAC_SCRIPT], {
    timeout: CALL_TIMEOUT_MS,
    encoding: 'utf8',
  });
  const [app, title, artist, album, url] = stdout.split('\n').map((l) => l.trim());

  // Nothing scriptable is playing, which does not mean nothing is.
  if (!app || !title) return readMacAudioApp();

  const bundle = bundleForAppName(app);
  return {
    title,
    artist: artist ?? '',
    album: album ?? '',
    url: url ?? '',
    app,
    icon: bundle ? await iconFor(bundle) : '',
  };
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

/** The same, but tolerating nothing playing, for comparing two moments. */
function keyOf2(np: NowPlaying | null): string {
  return np ? keyOf(np) : '';
}

export type MediaKind = 'music' | 'podcast' | 'video';

/**
 * Apps that read episodes rather than tracks, by name.
 *
 * None of these are AppleScript-scriptable on macOS -- Apple Podcasts ships
 * no scripting dictionary at all, and neither do the third-party clients --
 * so they only ever surface here through the audio-assertion fallback (app
 * name only) on macOS, or through MPRIS, which reads full metadata for any
 * of them, on Linux.
 */
const PODCAST_APPS = [
  'podcasts',
  'overcast',
  'pocket casts',
  'castro',
  'downcast',
  'castbox',
  'audible',
  'libro.fm',
  'kasts',
  'gnome podcasts',
  'gpodder',
];

/**
 * What kind of thing this is, which decides the verb and lets search tell a
 * podcast apart from a song without reading the text.
 *
 * Spotify hosts podcasts in the same app as music, so the app name alone
 * cannot tell them apart there -- but its share URL does: an episode is
 * `spotify:episode:...` or `open.spotify.com/episode/...`, a track is
 * `spotify:track:...`. Everywhere else, the app name is the only signal
 * there is.
 */
export function classify(np: NowPlaying): MediaKind {
  const url = np.url.toLowerCase();
  if (url.includes('spotify') && url.includes('episode')) return 'podcast';
  if (url.includes('youtu')) return 'video';
  if (PODCAST_APPS.some((a) => np.app.toLowerCase().includes(a))) return 'podcast';
  return 'music';
}

function verbFor(kind: MediaKind): string {
  if (kind === 'video') return 'Watched';
  if (kind === 'podcast') return 'Listened to';
  return 'Played';
}

/* ---------------- session grouping ---------------- */

/**
 * How long a gap with nothing new qualifying ends a session. Long enough
 * that pausing between episodes of the same show, or between two tracks
 * while doing something else, still reads as one sitting; short enough that
 * this morning's music and this evening's does not become one entry.
 */
const SESSION_GAP_MS = 10 * 60_000;

/** At most this many titles are spelled out; the rest are just a count. */
const SESSION_LIST_MAX = 5;

interface SessionTrack {
  title: string;
  artist: string;
  album: string;
}

interface Session {
  app: string;
  kind: MediaKind;
  tracks: SessionTrack[];
  url: string;
  startedAt: number;
  lastAt: number;
}

/**
 * A session collapsed into one line, so "what was I listening to during X"
 * has one readable answer instead of a page of individual tracks. A single-
 * track session reads exactly like `describe()` used to for every track.
 */
function describeSession(s: Session): string {
  const verb = verbFor(s.kind);
  const durationMin = Math.max(1, Math.round((s.lastAt - s.startedAt) / 60_000));
  const where = ` in ${s.app}`;

  if (s.tracks.length === 1) {
    const t = s.tracks[0];
    const by = t.artist ? (s.kind === 'podcast' ? ` on ${t.artist}` : ` by ${t.artist}`) : '';
    const on = t.album && s.kind === 'music' ? `, from ${t.album}` : '';
    const link = s.url ? `\n${s.url}` : '';
    return `${verb} "${t.title}"${by}${on}${where}.${link}`;
  }

  const shown = s.tracks.slice(0, SESSION_LIST_MAX).map((t) => `"${t.title}"`);
  const rest = s.tracks.length - shown.length;
  const list = rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
  const noun = s.kind === 'podcast' ? 'episodes' : s.kind === 'video' ? 'videos' : 'tracks';
  return `${verb} ${s.tracks.length} ${noun}${where} over ${durationMin}m: ${list}.`;
}

function sessionTitle(s: Session): string {
  if (s.tracks.length === 1) {
    const t = s.tracks[0];
    return t.artist ? `${t.title} — ${t.artist}` : t.title;
  }
  return `${s.tracks.length} ${s.kind === 'podcast' ? 'episodes' : 'tracks'} in ${s.app}`;
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
      note: 'Spotify and Music by name, and any other app -- browsers included -- as the source only. macOS will ask once for permission to control Spotify and Music.',
    };
  },

  create(): SourceInstance {
    let timer: NodeJS.Timeout | null = null;
    let captured = 0;
    let skipped = 0;
    let busy = false;
    let complained = false;
    /** What is playing right now, which the panel shows immediately. */
    let current: NowPlaying | null = null;

    /** The track being watched, and whether it has played long enough yet. */
    let pending: { key: string; since: number } | null = null;
    /** The run of tracks being collapsed into one chunk. */
    let session: Session | null = null;
    /** The last track actually folded into the session, so a still-playing
     *  track is not re-added on every poll. */
    let lastAddedKey: string | null = null;
    /** Kept so `stop()` can flush a session it did not start collapsing. */
    let ctxRef: CaptureContext | null = null;

    const flush = (ctx: CaptureContext): void => {
      const s = session;
      if (!s || !s.tracks.length) return;
      session = null;
      lastAddedKey = null;

      const res = ctx.capture({
        source: 'media',
        kind: 'media',
        text: describeSession(s),
        title: sessionTitle(s),
        ts: s.startedAt,
        meta: {
          app: s.app,
          mediaKind: s.kind,
          trackCount: s.tracks.length,
          artist: s.tracks.length === 1 ? s.tracks[0].artist : '',
          album: s.tracks.length === 1 ? s.tracks[0].album : '',
          path: s.url,
        },
      });
      if (res.added) captured++;
      else skipped++;
    };

    return {
      start(ctx) {
        ctxRef = ctx;
        const tick = async (): Promise<void> => {
          // A slow AppleScript must not stack up behind the next tick.
          if (busy) return;
          busy = true;
          try {
            const np = await read();

            // Report what is playing the moment it changes, whether or not
            // it has been on long enough to be worth remembering.
            if (keyOf2(current) !== keyOf2(np)) {
              current = np;
              ctx.changed?.();
            }

            // A session that has sat idle long enough is a finished sitting,
            // whether or not anything new has come along to replace it --
            // otherwise this morning's playlist would still be "open" and
            // absorb this evening's into the same chunk.
            if (session && Date.now() - session.lastAt > SESSION_GAP_MS) flush(ctx);

            if (!np) {
              pending = null;
              return;
            }

            // An app-only reading: something is playing, but nothing that can
            // be asked what. Worth showing in the notch, not worth writing
            // down -- a memory that says only "Firefox played something" is
            // not one anybody can search for.
            if (!np.title) {
              pending = null;
              return;
            }

            const key = keyOf(np);
            if (key === lastAddedKey) return; // already folded in, still playing

            if (!pending || pending.key !== key) {
              pending = { key, since: Date.now() };
              return;
            }
            if (Date.now() - pending.since < MIN_PLAY_MS) return;

            const now = Date.now();
            const kind = classify(np);
            const continuesSession =
              session !== null && session.app === np.app && now - session.lastAt < SESSION_GAP_MS;

            if (!continuesSession) {
              flush(ctx);
              session = { app: np.app, kind, tracks: [], url: '', startedAt: now, lastAt: now };
            }
            session!.tracks.push({ title: np.title, artist: np.artist, album: np.album });
            session!.lastAt = now;
            if (np.url) session!.url = np.url;
            lastAddedKey = key;
            pending = null;
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
        current = null;
        // A source stops when its setting is turned off or the app quits --
        // either way, whatever the session has so far is everything it will
        // ever have, so it is worth writing down rather than discarding.
        if (ctxRef) flush(ctxRef);
        session = null;
        lastAddedKey = null;
        ctxRef = null;
      },

      state() {
        return { running: timer !== null, captured, skipped, nowPlaying: current };
      },
    };
  },
};

export default source;
