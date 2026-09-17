# TODO

What is left, and why each one matters. Roughly in the order it is worth
doing.

## Before any of it is public

- [ ] **Turn Pages on and deploy the site.** Settings → Pages → Source: GitHub
      Actions, then run the **pages** workflow by hand. It is
      `workflow_dispatch` only on purpose: running it is what makes the page
      public. Add a `push:` trigger to `.github/workflows/pages.yml` once you
      want every commit to deploy.
- [ ] **Look at the app on a real screen.** Everything since the redesign was
      verified by typecheck, tests and static output; the window was last seen
      rendering in dark mode on Linux. Light mode, macOS and Windows are
      unchecked.
- [ ] **Check the notch panel on a Mac.** It is macOS-only, so nothing about
      it has been run since the restyle: `npm start` with the panel switched on
      in Settings, or `npx electron . --dev --notch-open`.
- [ ] **Tag a release and let CI build the three installers.** `build.yml`
      runs on `v*` tags and attaches the artifacts. Nothing has been packaged
      since the port to TypeScript.

## Features that exist as an API but not as UI

These all work in the main process and have a channel through `preload.ts`;
there is simply nothing in the window that calls them.

- [ ] **Embedding backend switcher.** `setEmbedBackend` is implemented end to
      end, and Settings has no control for it, so the only way to use Gemini or
      Voyage is to hand-edit `store.json`. Needs a backend picker, a provider
      picker, an API key field, and copy at the point of the switch that says
      plainly that captured text starts leaving the machine.
- [ ] **Retention controls.** `retentionDays` and `maxChunks` are honoured at
      startup and have no UI. Two number fields in Settings, with 0 meaning
      keep everything, as it does now.
- [ ] **Editing the quick capture shortcut.** Settings has the on/off switch
      and shows the accelerator, but the combination itself can only be changed
      in `store.json`. Needs a key-capture field. The refusal path is already
      handled: `QuickCapture.apply()` reports what the OS actually accepted.
- [ ] **Notch panel width.** `notchWidth` is a setting with no control. macOS
      does not expose the real notch size, so this is the nudge that lets
      someone fix the hover target on their own machine.

## Capture sources that are not built yet

Both register, report their real permission state, and say they are not
capturing. That is honest, but they are still holes in the product.

- [ ] **Meetings and audio (phase 2).** Permission handling is real;
      `src/main/capture/audio.ts` does no capture. Needs on-device
      transcription, a visible indicator whenever it is running, and a pause
      that is obviously reachable.
- [ ] **Screen (phase 3).** Same shape, in `src/main/capture/screen.ts`. It is
      the most invasive source, so it ships last and with the strictest
      treatment: frames read and discarded rather than stored, and an indicator
      that cannot be missed, because Windows and Linux do not gate screen
      capture behind any OS permission at all.

## Quality

- [ ] **Test the scheduler.** It is the riskiest untested code in the repo:
      chunked timers, daylight-saving-safe repeats, roll-forward of a time in
      the past, and snooze as an override that a tick consumes. `src/test/`
      currently covers the memory store only.
- [ ] **Test the chunker and the secret filter.** Both are pure functions with
      real consequences -- a chunk boundary that loses a sentence, a credential
      pattern that stops matching -- and both are trivial to test.
- [ ] **Build the website in CI.** `build.yml` typechecks, tests and packages
      the app, but nothing touches `web/`. A broken site is currently only
      discovered when you deploy it. Add a job that runs `npm ci` and
      `npm run build` in `web/`.
- [ ] **Sign the builds.** Unsigned is the default, so macOS shows an
      unidentified developer warning and SmartScreen warns about an
      unrecognised publisher. Both are one set of repository secrets away; see
      the Signing section of the README.

## The site

- [ ] **An Open Graph image.** The metadata declares
      `twitter:card = summary_large_image` and there is no image to go with it,
      so a shared link is a bare title. `web/app/opengraph-image.tsx` can
      generate one from the same tokens the page uses.
- [ ] **Stop hardcoding the version.** `VERSION` in `web/lib/site.ts` is
      `'0.1.0'` by hand and will drift from `package.json` at the first
      release. Read it at build time instead.
- [ ] **Decide about `site/index.html`.** It is the same landing page in one
      self-contained file, kept for a look with nothing installed. Two landing
      pages will drift; either accept that it is a snapshot and stop updating
      it, or delete it and let `web/` be the only version.
- [ ] **Docs that are still thin.** The reference pages are written from the
      code, but nothing has a screenshot in it, and the app has a screenshot
      tool built for exactly this:
      `npx electron . --dev --screenshot=out.png --tab=memory`.

## Known environment issue

- [ ] **Electron would not launch on this machine at the end of the session.**
      First `chrome-sandbox` was reported as not configured, then it hung even
      with `--no-sandbox`. It ran fine earlier the same day, so it is the
      environment rather than the code. The usual fix:

      ```
      sudo chown root:root node_modules/electron/dist/chrome-sandbox
      sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
      ```
