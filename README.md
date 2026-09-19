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
| **Related** | Any result opens its nearest neighbours in meaning, with no query and no model call |
| **Quick capture** | One global hotkey stores the clipboard on purpose, with nothing watching in between |
| **Now playing** | Remembers what you listen to and watch, so a day is searchable by what was on |
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

### Related

`related()` answers a different question from search: not "what matches this
query", but "what else is near this". The stored chunk's own vector is the
query, so it costs no embedding call, works offline, and is instant even with
a cloud backend configured.

Two details make the results worth reading. The floor is 0.25 rather than the
search floor of 0.1, because both sides are full passages here rather than a
short question and so sit higher on the cosine scale. And chunks split from
the same original capture are dropped: they are the rest of the same
paragraph, they always score highest, and they would fill the list with text
you are already looking at.

## Capture sources

| Source | Status | What it does |
|---|---|---|
| **Clipboard** | live | Remembers what you copy. Drops anything matching a credential shape or a high-entropy blob before storing it |
| **Folders** | live | Reads text and Markdown from folders you choose, and notices changes |
| **Quick capture** | live | A global hotkey (`⌘⇧M` / `Ctrl+Shift+M`) that stores the clipboard once, deliberately |
| **Now playing** | live | What you play, with the title, artist and link. MPRIS on Linux, including browser tabs; Spotify and Music on macOS |
| **Meetings & audio** | phase 2 | Permission handling is real; capture is not wired up yet |
| **Screen** | phase 3 | Same. The most invasive source, so it ships last and with the strictest treatment |

Sources that are not built yet still register and report their real permission
state. They say they are not capturing rather than implying that they are.

There is a global **pause** that keeps sources running but stores nothing, and a
**forget** on every result and every source.

### Now playing

The question this answers is the one nothing else can: what was that track,
or that video, that was on while I was working on the thing I now want to
find again. Media is a good index into a day precisely because it is
incidental -- you never wrote it down, and you would never have thought to.

On Linux it reads MPRIS over D-Bus, which every serious player speaks,
browsers included, so a YouTube tab arrives with the video title and the
channel as the artist. One `gdbus` call per player returns the playback state
and the metadata together, so a poll is one short-lived process and no
dependency: parsing GVariant by hand is cheaper than a native D-Bus binding
per platform and architecture, which is the same trade the memory store made.

On macOS it asks Spotify and Music over AppleScript. There is no supported
way to read what a browser is playing -- system-wide Now Playing lives behind
a private framework, and reading browser tabs instead means asking for
automation access to the browser, which is a much bigger ask than this is
worth. Windows has a real API for it (GlobalSystemMediaTransportControls) and
reaching it needs a native module or a WinRT round trip through PowerShell,
so it is not wired up and says so.

Nothing is stored until something has been playing for thirty seconds, so
skipping through a playlist leaves no trace, and paused is not playing:
leaving something paused all afternoon does not put it in your memory.

What is playing shows in the notch panel straight away, though, which is a
different question from whether it is worth remembering: the strip grows
sideways and says what it is, and the open panel has a line for it. A
capture always wins that space while it is on screen, because it is news and
it is gone in two seconds; the track is underneath, so the strip returns to
it rather than to nothing.

### Quick capture

The clipboard source is ambient: while it runs, everything you copy is stored.
The hotkey is the opposite trade -- nothing is watched, and one key press
stores one thing. Both can be on at once.

It refuses in four cases, and says which: nothing useful on the clipboard (it
opens the window instead), capture is paused, the text looks like a
credential, or you saved the same thing within the last six hours. Registering
a global shortcut can also simply fail, because whichever app asks first owns
the combination, so Settings shows **not registered** rather than a switch
that claims to be on.

## Connecting an LLM

Turn on the connector in the Memory tab. It binds to `127.0.0.1` only, and every
request needs a bearer token, because anything that can run on your machine can reach
loopback, and browsers will happily POST there, so the Origin header is checked
too.

**Claude Code / Claude Desktop**: spawn the stdio relay.

```
claude mcp add nibble -- node /path/to/nibble/out/mcp/stdio.js
```

The app shows the exact path. The relay is dependency-free on purpose: a client
spawns it with a plain `node`, which cannot `require` out of a packaged asar.

**Anything that takes a URL**: `http://127.0.0.1:8787/mcp`, with the token as a
`Bearer` header.

### Tools it exposes

| Tool | |
|---|---|
| `search_memory` | Keyword + semantic search, with source and date filters. Prints each chunk's id |
| `related_memory` | The nearest neighbours of a chunk, by meaning, from an id `search_memory` printed |
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

### How it moves

The panel is one silhouette clipped to a notch-shaped path: two concave
flares where it meets the top of the screen, two convex corners at the
bottom. It grows out of the notch and shrinks back into it, rather than
sliding into view from somewhere.

Three shapes, built from the same sequence of path commands with different
numbers in them. That is the whole trick: a browser interpolates one path
into another only when their commands line up, so the morph costs a CSS
transition instead of a frame loop.

  closed    the size of the notch, and invisible
  island    the notch plus a wing either side, when something was captured
  open      the full panel

The content inside is laid out at full size the whole time and is revealed by
the shape, so opening never has to lay anything out: the only work per frame
is a clip and a transform. Opening and closing are deliberately not the same
motion -- 520ms with the barest overshoot on the way out, 400ms with none on
the way back, because a panel that bounces as it leaves reads as a mistake.

Opening and closing are also intentions rather than events. The cursor has to
rest on the notch briefly before anything happens, and stray briefly before
it closes, so crossing the notch on the way to the menu bar does not fling
the panel out and a wobble on the way to a button does not lose it.

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
src/main/quickcapture.ts the global hotkey

src/main/memory/        chunker, store, hybrid search, embedder
src/main/memory/embed-worker.ts   the model, in its own process
src/main/capture/       capture sources behind one interface
src/main/mcp/server.ts  loopback MCP server
src/mcp/stdio.ts        dependency-free relay for stdio clients

src/preload.ts          the only bridge into the renderer
src/renderer/           the window UI (no framework)
src/renderer/tokens.css the design tokens, shared by both windows
src/renderer/notch.*    the notch panel's page, styles and script
src/renderer/env.d.ts   ambient types; the renderer stays a script, not a module
src/test/               store and search tests

scripts/make-icons.js   generates the mark from code, no image deps
scripts/adhoc-sign.js   ad-hoc signs unsigned macOS builds so they will launch
scripts/copy-assets.js  the renderer's html/css, which tsc does not emit
assets/fonts/           Satoshi, bundled so the app never fetches a font
web/                    the website (Next.js, static export)
site/index.html         the same story in one file, for a no-build preview
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

`npm run shots` does the same job without launching anything. The renderer is
plain HTML, CSS and one compiled script, and the only thing it needs from
Electron is `window.api`; stub that and the pages run in any Chromium. It
writes both windows, in every state worth looking at, into `out/shots`:

```
out/shots/window-reminders.png    window-memory.png    window-settings.png
out/shots/notch-collapsed.png     notch-island.png     notch-expanded.png
```

Two reasons to prefer it. It draws the UI against interesting data rather
than the empty state a fresh profile gives you, so a full reminder list, a
search with its nearest neighbours open, and every capture source running are
all one command away. And it works on a machine where Electron cannot open a
window at all, which is worth having the day that happens.

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
(`productName`, `appId`), `src/main/index.ts` (`setAppUserModelId`),
`src/mcp/stdio.ts` (`APP_DIR_NAME`, which locates the config) and the copy in
`web/` and `site/index.html`. The data folder name is the `FOLDER` constant in
`src/main/paths.ts`.

## The website

The site lives in `web/`: a Next.js app exported to static files, because
documentation for a desktop app has nothing to run on a server.

```
cd web
npm install
npm run dev      # http://localhost:3000
npm run build    # static export into web/out
```

`.github/workflows/pages.yml` builds and deploys it, and only runs when you
trigger it, because deploying makes the page public. Turn Pages on under
**Settings → Pages → Source: GitHub Actions**, then run the **pages** workflow.
It sets `NEXT_PUBLIC_BASE_PATH` from the repository name, since a project site
is served from `/<repo>` and every asset would otherwise 404.

`site/index.html` is the same story in one self-contained file, with no build
step, for opening straight off disk.

## The design

The window, the notch panel and the site all draw from one vocabulary: the ENS
design system ([Thorin](https://github.com/ensdomains/thorin)) in strict black
and white, with the edges left hard. Satoshi as the typeface, Thorin's
component shapes -- pill buttons, tag pills, switches, segmented tabs -- and no
colour anywhere: every state is a fill or a stroke, so it survives a monochrome
screen and a colour-blind reader alike.

The tokens are defined twice, once in `src/renderer/tokens.css` for the app and
once in `web/app/globals.css` for the site, because the two have no build step
in common. Satoshi is bundled in `assets/fonts/` rather than fetched from a CDN:
an app that promises nothing leaves the device should not open a connection to
someone else's server to draw its own text.

## What is left

[TODO.md](TODO.md): the unbuilt capture sources, the settings that exist
as an API but not as UI, and what has to happen before a release.

## License

MIT. See [LICENSE](LICENSE).
