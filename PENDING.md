# Pending feature bets

Not scoped, not scheduled — ideas worth building that extend what already
exists rather than bolt on something foreign. See [TODO.md](TODO.md) for what
is committed and in progress.

## Retrieval and capture

- [x] **Recall overlay.** Shipped: `⌘⇧K` (configurable) opens a small
      floating, always-on-top search box on any platform, not just the
      notch's Mac-only hover — the one gap this closes is Windows/Linux,
      which have no fast keyboard-driven recall at all otherwise. Type, see
      top hits inline (same hit-card look as the notch and the ask panel);
      Enter or a click hands the query to the main window's Memory tab
      (`focus-search` IPC → `activateTab('memory')` + `runSearch()`) and the
      overlay dismisses itself, via losing focus rather than an explicit
      close call. New: `src/main/hotkey.ts` (`GlobalHotkey`, factored out of
      `quickcapture.ts` since the recall trigger needed byte-for-byte the
      same OS-registration dance — same idempotent `apply()`, same honest
      `registered`/`error` reporting when another app owns the combination),
      `src/main/recall.ts` (window lifecycle: reused not recreated between
      summons, centred on whichever display the cursor is on, `screen-saver`
      level so it floats over fullscreen apps like the notch does), and
      `src/renderer/recall.{html,css,ts}`. Settings gained a "Recall
      overlay" row mirroring "Quick capture" exactly. Verified via
      typecheck, the full test suite, DOM-level console-error checks across
      every harness page, real screenshots of both the empty and
      results states, and a real (if non-interactive) launch of the packaged
      app on this machine to confirm the new wiring doesn't crash main-process
      startup.
- [ ] **Voice quick capture.** Hold the hotkey, speak, release — transcribed
      on-device and stored like any other capture. Reuses the same
      local-model infra pattern as the embedder (`utilityProcess`,
      downloaded once, offline). Extends quick capture beyond clipboard
      without touching the ambient/deliberate distinction that's already the
      product's core promise. Also de-risks the stalled Meetings/audio
      phase 2 by shipping the transcription pipeline for a narrower,
      deliberate use first.
- [ ] **Local entity tags.** Pull people/projects/URLs out of chunks with a
      small on-device NER pass at index time, store as facets, filter search
      by them. No cloud call, no LLM — pure local inference next to the
      existing embed worker. Gives search a second axis (who/what) beside
      meaning, using the same "index at write time, degrade gracefully"
      pattern the memory store already follows.
- [x] **In-app ask panel.** Shipped, as a notch tab rather than the main
      window -- the notch is the primary surface, so this is where
      conversational recall belongs. Retrieval is always local (the same
      hybrid search `search_memory` uses); only the question and the top
      chunks it turns up ever leave the machine, and only once a key is
      typed in. Gemini specifically, not the embedding backend picker as
      first imagined: Voyage has no chat completion endpoint at all, so
      "the same switch" would silently fail for half its settings. A
      dedicated `askApiKey` setting exists for this reason (falls back to
      `embedApiKey` when that's already pointed at Gemini). New:
      `src/main/tools/ask.ts` (retrieval + Gemini call + persisted
      transcript), an `ask` tab in the notch (`notch.html`/`notch.ts`/
      `notch.css`) with an inline key-entry box that appears only when no
      key is set. Along the way, fixed two pre-existing bugs the shots
      harness had been silently swallowing: `scripts/ui-shots.js` was
      missing several `window.api` stubs (`onTimersTick`, `onStatsTick`,
      `onNotchMessage`, and the rest of the notch-tools surface), which
      meant `paint()` and `renderHome()` had never actually run in any
      headless screenshot; and `renderHome()` itself referenced
      `#home-now`/`#home-now-track` elements that didn't exist in
      `notch.html`, so the home tab's "Now playing" row was silently never
      shown. Both fixed and verified with a real screenshot.
- [ ] **Own-device sync.** Pair two machines you own directly (QR code or
      local-network handshake, no account, no relay server) and merge
      `chunks.jsonl` append-only logs. Extends "portable" to "yours across
      machines" without breaking "no account, no server, no telemetry" — the
      append-only log format already makes this closer to a CRDT merge than
      a sync engine.

## Now playing, deeper into music and media

- [ ] **Spotify Web API enrichment.** Once a track is captured via
      AppleScript/MPRIS, hit Spotify's API (optional, user's own OAuth
      token) to pull genre, audio features, and playlist context — richer
      metadata than the OS gives you. Opt-in only, doesn't touch the
      offline-by-default promise since it's a separate enrichment pass on
      data already captured locally.
- [x] **Listening-session grouping.** Shipped. A run of tracks from the same
      app, with no gap over ten minutes, collapses into one chunk instead of
      one row per track: `describeSession()` in `src/main/capture/media.ts`.
      A session flushes on a gap, an app change, or the source stopping, so
      the tail is never silently dropped. The notch's hit list shows a
      track-count pill for it (`.kind-pill` in `notch.ts`/`notch.css`).
- [x] **Podcast/audiobook support.** Shipped, honestly scoped to what is
      actually reachable: Apple Podcasts and third-party clients (Overcast,
      Pocket Casts, ...) ship no AppleScript dictionary at all -- confirmed
      against this machine with `sdef`, empty -- so macOS still only reads
      title/artist from Spotify and Music. `classify()` in `media.ts` now
      tells a podcast apart from music by app name (for MPRIS and the
      generic case) and by URL shape for Spotify specifically (`open.spotify
      .com/episode/...` is a podcast even though the app is the same app
      that plays songs). Changes the verb to "Listened to" and tags
      `meta.mediaKind`, surfaced in the notch as a "podcast" pill.
- [x] **"Playing while capturing" cross-link.** Shipped. `CaptureManager
      .nowPlaying()` in `src/main/capture/index.ts` is asked fresh on every
      capture and folded into `meta.nowPlaying` for anything that isn't
      media's own capture of itself -- wired at the three points that store
      something deliberately (clipboard/folder capture through the manager,
      quick capture and the manual "remember" call in `index.ts`, both of
      which bypass the manager and needed the same call added directly). The
      notch's hit list shows it as a "♪ track — artist" line under the
      capture (`.np-link`).
- [ ] **YouTube Music / browser-native players on macOS.** Since MPRIS
      already picks up browser tabs on Linux, investigate whether a
      MediaSession-reading Safari/Chrome extension (user-installed,
      explicit) can supply the same on macOS without full automation
      access. Fills the one gap the README calls out as unsolved — "no
      supported way to read what a browser is playing" on macOS — with an
      opt-in extension instead of a private framework.
