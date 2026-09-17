'use strict';
const { systemPreferences } = require('electron');

/**
 * Periodic screen capture -> OCR -> text. Phase 3.
 *
 * Permission reporting is real; capture is not wired up, and `implemented`
 * says so. This is the most invasive source in the app, so when it does land
 * it gets the strictest treatment: a visible recording indicator whenever it
 * is on, an app/window denylist that is honoured before a frame is taken, and
 * frames that are OCR'd and discarded rather than stored as images.
 *
 * What the remaining work is:
 *
 *   frames       desktopCapturer.getSources with a thumbnail size, on an
 *                interval, skipping frames that are near-identical to the last
 *                one so an idle screen costs nothing.
 *
 *   OCR          Xenova/trocr-small-printed through transformers.js, or the
 *                platform engines (Vision on macOS, Windows.Media.Ocr) which
 *                are better but each need a native addon.
 *
 *   permission   macOS gates this behind Screen Recording, which cannot be
 *                granted from inside the app -- the user has to enable it in
 *                System Settings and relaunch. Windows and Linux do not gate
 *                it at all, which is exactly why the visible indicator matters
 *                more there, not less.
 */

module.exports = {
  id: 'screen',
  label: 'Screen',
  description: 'Reads text off your screen on a timer. Not capturing yet — this is the last phase.',
  platforms: ['darwin', 'win32', 'linux'],
  permission: 'screen',
  implemented: false,

  available() {
    if (process.platform !== 'darwin') {
      return {
        ok: false,
        reason: 'Not wired up yet',
        permission: 'not-required',
        note: 'No OS permission gate here — the on-screen indicator is the only thing telling you it is running.',
      };
    }
    let status = 'unknown';
    try {
      status = systemPreferences.getMediaAccessStatus('screen');
    } catch {
      status = 'unknown';
    }
    return {
      ok: false,
      reason: 'Not wired up yet',
      permission: status,
      note: 'macOS requires Screen Recording in System Settings, and the app has to be relaunched after granting it.',
    };
  },

  /**
   * macOS has no in-app prompt for screen recording; the honest move is to
   * send the user straight to the right settings pane.
   */
  async requestPermission() {
    if (process.platform !== 'darwin') return { granted: true, status: 'not-required' };
    const { shell } = require('electron');
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    );
    return { granted: false, status: 'opened-settings', needsRelaunch: true };
  },

  create() {
    return {
      start() {
        throw new Error('Screen capture is not implemented yet');
      },
      stop() {},
      state() {
        return { running: false, captured: 0 };
      },
    };
  },
};
