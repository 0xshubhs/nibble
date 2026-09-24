import { classify, gvarValue, parseMpris, playerName } from '../main/capture/media';
import type { NowPlaying } from '../types';

/**
 * The MPRIS reader parses gdbus output by hand, so these are the shapes it
 * has to survive: a variant-wrapped string, an array of them, an empty one,
 * a quote escaped inside a title, and the several keys that are not strings
 * at all and must not be mistaken for one.
 *
 * The fixtures are written in the exact format gdbus prints, with invented
 * content.
 */

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = ''): void => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ok  ' : 'FAIL  ') + name + (cond ? '' : `  <-- ${extra}`));
};

const playing = `({'CanControl': <true>, 'CanPause': <true>, 'Metadata': <{'mpris:artUrl': <'file:///tmp/.org.chromium.Chromium.J6M3S6'>, 'mpris:length': <int64 5305601000>, 'mpris:trackid': <objectpath '/com/brave/MediaPlayer2/TrackList/Track1AC1'>, 'xesam:album': <''>, 'xesam:artist': <['Some Channel']>, 'xesam:title': <'Why Rank Fusion Works | a talk'>, 'xesam:url': <'https://www.youtube.com/watch?v=abc123'>}>, 'PlaybackStatus': <'Playing'>, 'Position': <int64 875475>, 'Rate': <0.0>, 'Volume': <1.0>},)`;

const paused = playing.replace("'PlaybackStatus': <'Playing'>", "'PlaybackStatus': <'Paused'>");

const spotify = `({'Metadata': <{'xesam:album': <'The Album'>, 'xesam:artist': <['First Artist', 'Second Artist']>, 'xesam:title': <'It\\'s a Title'>, 'xesam:url': <'https://open.spotify.com/track/xyz'>}>, 'PlaybackStatus': <'Playing'>},)`;

const untitled = playing.replace("'xesam:title': <'Why Rank Fusion Works | a talk'>", "'xesam:title': <''>");

/* ---------------- gvarValue ---------------- */

ok('reads a variant-wrapped string', gvarValue(playing, 'PlaybackStatus') === 'Playing');
ok(
  'reads a title containing a pipe',
  gvarValue(playing, 'xesam:title') === 'Why Rank Fusion Works | a talk',
  String(gvarValue(playing, 'xesam:title'))
);
ok('reads a one-element array', gvarValue(playing, 'xesam:artist') === 'Some Channel');
ok(
  'joins a multi-element array',
  gvarValue(spotify, 'xesam:artist') === 'First Artist, Second Artist',
  String(gvarValue(spotify, 'xesam:artist'))
);
ok('an empty string stays empty, not null', gvarValue(playing, 'xesam:album') === '');
ok(
  'unescapes a quote inside a string',
  gvarValue(spotify, 'xesam:title') === "It's a Title",
  String(gvarValue(spotify, 'xesam:title'))
);
ok('a missing key is null', gvarValue(playing, 'xesam:nothing') === null);
// The keys either side of a value matter: a sloppy regex reads past them.
ok('a number is not read as a string', gvarValue(playing, 'mpris:length') === null);
ok('a boolean is not read as a string', gvarValue(playing, 'CanPause') === null);
ok('an object path is not read as a string', gvarValue(playing, 'mpris:trackid') === null);

/* ---------------- parseMpris ---------------- */

const np = parseMpris(playing, 'Brave');
ok('playing yields a track', np !== null);
ok('title', np?.title === 'Why Rank Fusion Works | a talk', String(np?.title));
ok('artist', np?.artist === 'Some Channel');
ok('url', np?.url === 'https://www.youtube.com/watch?v=abc123');
ok('app', np?.app === 'Brave');
ok('album left empty rather than undefined', np?.album === '');

ok('paused yields nothing', parseMpris(paused, 'Brave') === null);
ok('a player with no title yields nothing', parseMpris(untitled, 'Brave') === null);
ok('a stopped player yields nothing', parseMpris(`({'PlaybackStatus': <'Stopped'>},)`, 'X') === null);
ok('an empty reply yields nothing', parseMpris('', 'X') === null);

const sp = parseMpris(spotify, 'Spotify');
ok('spotify track parses', sp?.title === "It's a Title" && sp?.album === 'The Album');

/* ---------------- playerName ---------------- */

ok('instance suffix is dropped', playerName('org.mpris.MediaPlayer2.brave.instance9412') === 'Brave');
ok('a plain name is capitalised', playerName('org.mpris.MediaPlayer2.spotify') === 'Spotify');
ok('an unknown shape still returns something', playerName('org.mpris.MediaPlayer2.vlc') === 'Vlc');

/* ---------------- classify ---------------- */

const track = (over: Partial<NowPlaying>): NowPlaying => ({
  title: 'A Title',
  artist: 'An Artist',
  album: '',
  url: '',
  app: 'Spotify',
  ...over,
});

ok(
  'a youtube url is a video regardless of app',
  classify(track({ app: 'Brave', url: 'https://www.youtube.com/watch?v=x' })) === 'video'
);
ok(
  'a spotify episode url is a podcast even though the app is Spotify',
  classify(track({ app: 'Spotify', url: 'https://open.spotify.com/episode/abc' })) === 'podcast'
);
ok(
  'a spotify track url is music',
  classify(track({ app: 'Spotify', url: 'https://open.spotify.com/track/abc' })) === 'music'
);
ok('a known podcast app is a podcast with no url at all', classify(track({ app: 'Overcast', url: '' })) === 'podcast');
ok(
  'the podcast app match is case-insensitive',
  classify(track({ app: 'POCKET CASTS', url: '' })) === 'podcast'
);
ok('an unrecognised app with no url is music', classify(track({ app: 'Brave', url: '' })) === 'music');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
