# Nibble

A portable, background-running desktop app for **macOS, Windows and Linux** that
keeps a local memory of what you capture, indexes it on device, and exposes it to
any LLM over MCP, plus reminders that fire as real system notifications.

One Electron codebase, three real builds: a `.dmg`, a portable `.exe` and an
`.AppImage`. No account, no server, no telemetry.

Written in TypeScript, strict mode, with no bundler: plain `tsc` to `out/`.

```
npm install
npm start           # compile, then run
npm run watch       # tsc --watch while developing
npm run typecheck   # no emit
npm test            # store + search tests
npm run build:mac   # .dmg + .zip     (arm64 + x64)
npm run build:win   # portable .exe + setup + .zip
npm run build:linux # .AppImage + .deb + .tar.gz
```

`rootDir` is `src` and `outDir` is `out`, so every file compiles to the same
depth it was written at: `src/main/index.ts` becomes `out/main/index.js`. The
main process resolves the preload, the renderer, the embedding worker and the
MCP relay through `__dirname`, and this keeps all of those paths correct
without a single change between running from source and running packaged.

Each target must be built on its own OS. `.github/workflows/build.yml` runs the
three natively and attaches the results to a GitHub release when you push a tag.

## What it does

| | |
|---|---|
| **Memory** | Captures text, chunks it, embeds it on device, and searches it by keyword *and* meaning |
| **MCP connector** | Claude, ChatGPT or any MCP client can query that memory as a tool |
| **Reminders** | Once, hourly, daily, weekdays, weekly, or a custom interval |
| **Portable** | Data lives beside the executable, not in your profile |
| **Background** | Closing the window hides it; the tray icon keeps everything running |
| **Offline** | The default embedding model runs locally. Nothing is uploaded |

## The memory

Capture and indexing are decoupled. Text is written and **keyword-searchable
immediately**, with its vector slot zeroed and filled in behind it, so a model
that is still downloading degrades search quality instead of dropping data.

Search fuses BM25 and cosine similarity with Reciprocal Rank Fusion, so the two
scoring scales never have to be reconciled, and something both methods like
outranks something only one of them loves. A cosine floor keeps unrelated
chunks out, so "no results" is an answer the search can actually give.

### Storage

Two flat files, no database:

```
memory/chunks.jsonl   one JSON record per line, appended, never rewritten
memory/vectors.bin    fixed-width Float32 rows; row N belongs to line N
memory/meta.json      embedding width and model id
```

A native SQLite build would mean a compiled module per platform *and*
architecture. This behaves identically everywhere, and the keyword index is
rebuilt at load in a few milliseconds.

Whether a row is embedded is derived from the vector file rather than stored, so
the log and the vectors cannot drift apart if the app is killed mid-batch.
Deletions are tombstones; **Compact** reclaims the space.

### Embeddings

| Backend | Model | Width | Notes |
|---|---|---|---|
| `local` (default) | `Xenova/all-MiniLM-L6-v2` | 384 | ~23 MB, downloaded once, then fully offline |
| `cloud` | Gemini or Voyage | 768 / 1024 | Better recall, needs an API key, text leaves the device |

The local model runs in a `utilityProcess`. Embedding a batch is tens of
milliseconds of CPU, which in the main process would stall the tray, the window
and the reminder timers. Switching backends invalidates the stored vectors and
re-embeds in the background, because vectors from different models are not
comparable even at the same width.

## Capture sources

| Source | Status | What it does |
|---|---|---|
| **Clipboard** | live | Remembers what you copy. Drops anything matching a credential shape or a high-entropy blob before storing it |
| **Folders** | live | Reads text and Markdown from folders you choose, and notices changes |
| **Meetings & audio** | phase 2 | Permission handling is real; capture is not wired up yet |
| **Screen** | phase 3 | Same. The most invasive source, so it ships last and with the strictest treatment |

Sources that are not built yet still register and report their real permission
state. They say they are not capturing rather than implying that they are.

There is a global **pause** that keeps sources running but stores nothing, and a
**forget** on every result and every source.

## Connecting an LLM

Turn on the connector in the Memory tab. It binds to `127.0.0.1` only, and every
request needs a bearer token, because anything that can run on your machine can reach
loopback, and browsers will happily POST there, so the Origin header is checked
too.

**Claude Code / Claude Desktop**: spawn the stdio relay.

```
claude mcp add nibble -- node /path/to/src/mcp/stdio.js
```

The app shows the exact path. The relay is dependency-free on purpose: a client
spawns it with a plain `node`, which cannot `require` out of a packaged asar.

**Anything that takes a URL**: `http://127.0.0.1:8787/mcp`, with the token as a
`Bearer` header.

### Tools it exposes

| Tool | |
|---|---|
| `search_memory` | Keyword + semantic search, with source and date filters |
| `recent_memory` | Newest captures first |
| `remember` | Store something from the conversation |
| `memory_stats` | Counts, model, index state |
| `list_reminders` | Scheduled reminders, soonest first |
| `add_reminder` | Schedule a notification |

## The notch panel (macOS)

A panel that hangs off the MacBook notch: hover it for a search box, the next
reminder and a pause toggle, or drop text or a file on it to remember it. Off
by default; the switch is in Settings.

There is no API for any of this. macOS exposes the notch only through
`NSScreen.safeAreaInsets`, which Electron does not surface, so the panel is a
borderless transparent `NSPanel` pinned to the top centre of the internal
display. Three details make it behave like part of the system:

- the window level is `screen-saver`, the only level above the menu bar
- it is visible on every space and over fullscreen apps, or it vanishes the
  moment you switch desktops
- collapsed, it ignores mouse events and forwards them, so the menu bar
  underneath stays clickable, and hover is detected by polling the cursor,
  because a window that ignores mouse events cannot receive them

At rest it paints nothing at all. Drawing a collapsed lip only looks right if
it exactly covers the physical notch, and nothing can tell us how wide that is,
so any guess would show as black wings on one machine and a gap on another.

Notch detection is a guess too, and the obvious signal does not work: a 14" M3
reports a 29pt menu bar at one scaled resolution while an external 1080p
display reports 30pt. It reads the model identifier instead, and the panel
still works on a Mac without a notch, it just hangs from the top of the screen.

`--notch-open` opens the panel on launch during development, since hovering
cannot be scripted.

## Where it stores things

Portable mode turns on when any of these is true, and everything lives in a
`nibble-data` folder next to the executable:

- launched with `--portable`
- the Windows `portable` build (sets `PORTABLE_EXECUTABLE_DIR`)
- running as an AppImage (sets `APPIMAGE`)
- a file named `portable` sits next to the executable

Otherwise it uses the normal per-user location: `~/Library/Application Support`,
`%APPDATA%`, or `~/.config`. The tray menu's **Show data folder** opens whichever
is in use.

## Layout

```
src/types.ts            every shape that crosses a boundary
src/main/index.ts       app wiring, windows, IPC
src/main/scheduler.ts   the reminder clock (chunked timers, DST-safe repeats)
src/main/store.ts       settings and reminders
src/main/paths.ts       portable-vs-installed data directory
src/main/autostart.ts   login items: LaunchServices / Run key / XDG autostart
src/main/tray.ts        menu bar icon and menu
src/main/notifier.ts    native notifications
src/main/notch.ts       the macOS notch panel

src/main/memory/        chunker, store, hybrid search, embedder
src/main/memory/embed-worker.ts   the model, in its own process
src/main/capture/       capture sources behind one interface
src/main/mcp/server.ts  loopback MCP server
src/mcp/stdio.ts        dependency-free relay for stdio clients

src/preload.ts          the only bridge into the renderer
src/renderer/           the window UI (no framework)
src/renderer/notch.*    the notch panel's page, styles and script
src/renderer/env.d.ts   ambient types; the renderer stays a script, not a module
src/test/               store and search tests

scripts/make-icons.js   generates the mouse mascot from code, no image deps
scripts/adhoc-sign.js   ad-hoc signs unsigned macOS builds so they will launch
scripts/copy-assets.js  the renderer's html/css, which tsc does not emit
site/                   the landing page
```

`RendererApi` in `src/types.ts` is implemented by `src/preload.ts` and declared
as `window.api` for the renderer, so adding a channel on one side without the
other is a compile error rather than a runtime `undefined`.

## Development

`--screenshot=<file>` renders the window, captures it and exits. Handy for
checking a change without a screen grab picking up whatever else is in front:

```
npx electron . --dev --screenshot=out.png --tab=memory --query="release process"
```

## Signing

Builds are unsigned by default, so macOS shows an "unidentified developer"
warning on first launch (right-click → Open, or allow it in **System Settings →
Privacy & Security**).

To sign, add these repository secrets and drop the
`CSC_IDENTITY_AUTO_DISCOVERY: false` line from the workflow:

- macOS: `CSC_LINK` (base64 `.p12`), `CSC_KEY_PASSWORD`, plus `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarization
- Windows: `CSC_LINK` and `CSC_KEY_PASSWORD`

## Renaming it

The product name appears in `package.json` (`productName`), `electron-builder.yml`
(`productName`, `appId`), `src/main/index.js` (`setAppUserModelId`),
`src/mcp/stdio.js` (`APP_DIR_NAME`, which locates the config) and the copy in
`site/index.html`. The data folder name is the `FOLDER` constant in
`src/main/paths.js`.

## Publishing the site

The landing page lives in `site/index.html`. `.github/workflows/pages.yml`
deploys it, but it only runs when you trigger it, because deploying makes the page
public. Turn Pages on under **Settings → Pages → Source: GitHub Actions**, then
run the **pages** workflow.

## License

MIT. See [LICENSE](LICENSE).
