#!/usr/bin/env node
/**
 * Screenshots the window and the notch panel without launching the app.
 *
 * The renderer is plain HTML, CSS and one compiled script; the only thing it
 * needs from Electron is `window.api`. Stub that and the pages run in any
 * Chromium, which means the UI can be checked on a machine where Electron
 * cannot open a window at all -- and checked against interesting data rather
 * than the empty state a fresh profile gives you.
 *
 *   node scripts/ui-shots.js [outDir] [--platform=darwin|linux|win32]
 *
 * It writes harness copies of the two pages into out/renderer/ (they are
 * gitignored with the rest of out/) and, if it can find a Chromium, a set of
 * PNGs beside them. Without one it still writes the harnesses, which can be
 * opened in any browser by hand.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'out', 'renderer');

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--')) ?? path.join(ROOT, 'out', 'shots');
const platform = (args.find((a) => a.startsWith('--platform=')) ?? '--platform=darwin').slice(11);

/* ---------------- the data the UI is drawn against ---------------- */

const now = Date.now();

const hit = (id, source, title, text, ago) => ({
  id,
  source,
  kind: 'text',
  title,
  text,
  ts: now - ago,
  meta: {},
  score: 0.42,
  matched: 'both',
});

const snapshot = {
  reminders: [
    {
      id: 'r1', title: 'Push the release tag', body: 'CI builds all three installers',
      at: now + 42 * 60000, repeat: 'none', intervalMinutes: 60, enabled: true,
      snoozedUntil: null, createdAt: now, lastFiredAt: null,
    },
    {
      id: 'r2', title: 'Stand up and stretch', body: '',
      at: now + 3 * 3600000, repeat: 'hourly', intervalMinutes: 60, enabled: true,
      snoozedUntil: now + 9 * 60000, createdAt: now, lastFiredAt: null,
    },
    {
      id: 'r3', title: 'Weekly review', body: 'What did I actually finish?',
      at: now + 4 * 86400000, repeat: 'weekly', intervalMinutes: 60, enabled: false,
      snoozedUntil: null, createdAt: now, lastFiredAt: null,
    },
  ],
  settings: {
    launchAtLogin: true, startHidden: true, showInDock: false, notificationSound: true,
    snoozeMinutes: 10,
    captureSources: { clipboard: true, files: true, media: true, audio: false, screen: false },
    memoryFolders: ['/home/you/notes', '/home/you/work/runbooks'],
    capturePaused: false, allowModelDownload: true, embedBackend: 'local',
    embedProvider: 'gemini', embedApiKey: '', retentionDays: 0, maxChunks: 0,
    mcpEnabled: true, mcpPort: 8787, mcpToken: 'tok_abcdefghijklmnopqrstuvwx',
    quickCaptureEnabled: true, quickCaptureShortcut: 'CommandOrControl+Shift+M',
    notchEnabled: true, notchWidth: 200,
  },
  meta: {
    version: '0.1.0', name: 'Nibble', platform, portable: false,
    dataDir:
      platform === 'darwin'
        ? '/Users/you/Library/Application Support/Nibble'
        : '/home/you/.config/Nibble',
    notifications: true,
    relay: '/Applications/Nibble.app/Contents/Resources/mcp/stdio.js',
    notch: { supported: platform === 'darwin', likelyNotched: true, enabled: true },
    quickCapture: {
      enabled: true, accelerator: 'CommandOrControl+Shift+M', registered: true, error: null,
    },
  },
  memory: {
    stats: {
      chunks: 1790, embedded: 1284, pending: 506, tombstones: 12,
      textBytes: 3100000, vectorBytes: 2750000,
      model: 'Xenova/all-MiniLM-L6-v2', dim: 384,
      embedder: {
        backend: 'local', provider: 'gemini', hasKey: false, ready: true, status: 'ready',
        progress: 100, dim: 384, model: 'Xenova/all-MiniLM-L6-v2', error: null,
      },
    },
    sources: [
      {
        id: 'clipboard', label: 'Clipboard',
        description: 'Remembers text you copy. Skips anything that looks like a password or key.',
        implemented: true, supported: true, permission: null, available: { ok: true },
        enabled: true, state: { running: true, captured: 412, skipped: 19 },
      },
      {
        id: 'files', label: 'Folders',
        description: 'Reads text and Markdown files from folders you choose, and notices when they change.',
        implemented: true, supported: true, permission: null, available: { ok: true },
        enabled: true, state: { running: true, captured: 1203, folders: 2 },
      },
      {
        id: 'media', label: 'Now playing',
        description: 'Remembers what you listen to and watch, with the title, the artist and the link.',
        implemented: true, supported: true, permission: null,
        available: { ok: true, note: 'Reads any player that speaks MPRIS, browser tabs included.' },
        enabled: true, state: { running: true, captured: 37 },
      },
      {
        id: 'audio', label: 'Meetings & audio',
        description: 'Transcribes what you say and hear, on device. Not capturing yet.',
        implemented: false, supported: true, permission: 'microphone',
        available: { ok: true, permission: 'not-determined' },
        enabled: false, state: { running: false, captured: 0 },
      },
      {
        id: 'screen', label: 'Screen',
        description: 'Reads text from your screen on this device. Not capturing yet.',
        implemented: false, supported: true, permission: 'screen',
        available: { ok: true, permission: 'denied' },
        enabled: false, state: { running: false, captured: 0 },
      },
    ],
    paused: false,
    mcp: {
      running: true, port: 8787, token: 'tok_abcdefghijklmnopqrstuvwx',
      url: 'http://127.0.0.1:8787/mcp', error: null,
      calls: [
        { ts: now, name: 'search_memory', args: {} },
        { ts: now, name: 'related_memory', args: {} },
      ],
    },
  },
};

const results = [
  hit('a41f0c8e21b3_0', 'files', 'Standup notes',
    'We are cutting the Windows ARM build until someone actually asks for it. Nobody on the team has hardware to test it on, and the CI minutes are the real cost.',
    2 * 86400000),
  hit('9d2c1b77aa04_1', 'clipboard', '',
    'Rotate the staging credentials every ninety days. Whoever is on call does it, and the runbook has the exact steps.',
    5 * 3600000),
  hit('55ab90ff1c22_0', 'media', 'Why Rank Fusion Works — Some Channel',
    'Played "Why Rank Fusion Works" by Some Channel in Brave.\nhttps://www.youtube.com/watch?v=abc123',
    40 * 60000),
];

const related = [
  { ...hit('7f3e', 'files', 'CI minutes', 'The ARM runners are billed at ten times the x64 rate, which is most of the bill.', 2 * 86400000), score: 0.71, matched: 'meaning' },
  { ...hit('2c9a', 'clipboard', '', 'GitHub ARM runner pricing page, copied while working out what the build would cost.', 2 * 86400000), score: 0.64, matched: 'meaning' },
];

/* ---------------- the harness ---------------- */

const nowPlaying = {
  title: 'Why Rank Fusion Works',
  artist: 'Some Channel',
  album: '',
  url: 'https://www.youtube.com/watch?v=abc123',
  app: 'Brave',
};

const nothing = '() => Promise.resolve(null)';
const bridge = `<script>
const SNAPSHOT = ${JSON.stringify(snapshot)};
// ?playing=1 puts a track on the media source, the way the source itself
// reports one: live, before anything has been captured.
if (new URLSearchParams(location.search).get('playing')) {
  SNAPSHOT.memory.sources.find((s) => s.id === 'media').state.nowPlaying =
    ${JSON.stringify(nowPlaying)};
}
window.api = {
  getState: () => Promise.resolve(SNAPSHOT),
  searchMemory: () => Promise.resolve(${JSON.stringify(results)}),
  recentMemory: () => Promise.resolve(${JSON.stringify(results)}),
  relatedMemory: () => Promise.resolve(${JSON.stringify(related)}),
  memoryStats: () => Promise.resolve(${JSON.stringify(snapshot.memory.stats)}),
  onState: () => () => {}, onFocusReminder: () => () => {},
  onNotchExpanded: () => () => {}, onNotchPulse: () => () => {},
  onNotchGeometry: () => () => {},
  captureNote: () => Promise.resolve({ added: 1, skipped: null }),
  setCapture: () => Promise.resolve({ ok: true, sources: [] }),
  setPaused: () => Promise.resolve(false), forget: () => Promise.resolve(true),
  compactMemory: () => Promise.resolve(0), addFolder: () => Promise.resolve([]),
  removeFolder: () => Promise.resolve([]), forgetSource: () => Promise.resolve(0),
  setSetting: () => Promise.resolve(${JSON.stringify(snapshot.settings)}),
  setNotch: () => Promise.resolve(true), closeNotch: () => Promise.resolve(),
  showWindow: () => Promise.resolve(), pathForFile: () => '',
  rememberFiles: () => Promise.resolve(0), testNotification: () => Promise.resolve(true),
  revealData: () => Promise.resolve(''), quit: () => Promise.resolve(),
  requestCapturePermission: () => Promise.resolve({ granted: false, status: 'denied' }),
  saveReminder: ${nothing}, deleteReminder: () => Promise.resolve(true),
  toggleReminder: ${nothing}, snoozeReminder: ${nothing},
  setMcp: ${nothing}, regenerateMcpToken: ${nothing}, setEmbedBackend: ${nothing},
};
<\/script>`;

/**
 * State is set before the first paint rather than on a timer: a headless
 * screenshot runs on virtual time, where a setTimeout can easily land after
 * the picture has already been taken.
 */
const driver = `<script>
(() => {
  const q = new URLSearchParams(location.search);
  const tab = q.get('tab');
  if (tab) document.querySelector('[data-tab="' + tab + '"]').click();
  if (q.get('expanded')) document.body.classList.add('expanded');
  if (q.get('pulsing')) {
    document.body.classList.add('pulsing');
    const t = document.getElementById('lip-text');
    if (t) t.textContent = 'Remembered';
  }
  // Collapsed, the panel is invisible by design; this makes the silhouette
  // visible so the shape itself can be looked at.
  if (q.get('ghost')) {
    const s = document.getElementById('shell');
    if (s) { s.style.opacity = '1'; s.style.transition = 'none'; }
  }
  if (typeof applyShape === 'function') applyShape();
  // Anything that needs data has to wait for it.
  if (q.get('related')) setTimeout(() => {
    const b = [...document.querySelectorAll('.hit-foot button')]
      .find((x) => x.textContent === 'Related');
    if (b) b.click();
  }, 250);
})();
<\/script>`;

function harness(src, dest, extraCss) {
  let html = fs.readFileSync(path.join(RENDERER, src), 'utf8');
  // The page's CSP forbids inline script. The harness never ships, so it goes.
  html = html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '');
  html = html.replace(/<script src=/, `${bridge}\n    <script src=`);
  html = html.replace(/<\/body>/, `${driver}</body>`);
  if (extraCss) html = html.replace('</head>', `<style>${extraCss}</style></head>`);
  fs.writeFileSync(path.join(RENDERER, dest), html);
  return path.join(RENDERER, dest);
}

// The notch panel draws black onto a transparent window, so give it
// something to be seen against.
const DESKTOP = `
  html { background: linear-gradient(160deg, #6d7a8c, #48525f); }
  body::before { content: ''; position: fixed; inset: 0 0 auto 0;
    height: var(--menubar-h, 32px); background: rgba(255, 255, 255, 0.14); }
`;

const windowPage = harness('index.html', 'harness-window.html');
const notchPage = harness('notch.html', 'harness-notch.html', DESKTOP);
console.log(`  harnesses written to ${path.relative(ROOT, RENDERER)}/`);

/* ---------------- the screenshots ---------------- */

const CHROME = ['google-chrome', 'chromium', 'chromium-browser', 'brave-browser'].find((bin) => {
  try {
    execFileSync('which', [bin], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});

if (!CHROME) {
  console.log('  no chromium found; open the harnesses in a browser instead');
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });

const shots = [
  ['window-reminders', windowPage, '', '900,700'],
  ['window-memory', windowPage, '?tab=memory&related=1', '900,1000'],
  ['window-settings', windowPage, '?tab=settings', '900,820'],
  ['notch-collapsed', notchPage, '?ghost=1', '500,140'],
  ['notch-island', notchPage, '?pulsing=1', '500,140'],
  ['notch-playing', notchPage, '?playing=1', '500,140'],
  ['notch-expanded', notchPage, '?expanded=1&playing=1', '500,320'],
];

for (const [name, page, query, size] of shots) {
  const file = path.join(outDir, `${name}.png`);
  try {
    execFileSync(
      CHROME,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--virtual-time-budget=5000',
        `--window-size=${size}`,
        `--screenshot=${file}`,
        `file://${page}${query}`,
      ],
      { stdio: 'ignore', timeout: 60000 }
    );
    console.log(`  ${fs.existsSync(file) ? 'ok  ' : 'FAIL'} ${path.relative(ROOT, file)}`);
  } catch {
    console.log(`  FAIL ${name}`);
  }
}
