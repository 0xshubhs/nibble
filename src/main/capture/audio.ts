import { systemPreferences } from 'electron';
import type { CaptureSource, PermissionResult, SourceInstance } from '../../types';

/**
 * Meeting and system audio -> transcript. Phase 2.
 *
 * The permission handling below is real and works today; the capture pipeline
 * behind it is not wired up yet, and `implemented` says so rather than letting
 * the UI imply that switching this on records anything.
 *
 * What the remaining work is, per platform:
 *
 *   microphone   getUserMedia in a hidden renderer on all three platforms.
 *                Straightforward; macOS needs NSMicrophoneUsageDescription in
 *                the Info.plist, which electron-builder writes from
 *                `mac.extendInfo`.
 *
 *   system audio Windows and Linux can loop back through desktopCapturer with
 *                chromeMediaSource: 'desktop'. macOS cannot -- Chromium has no
 *                loopback there, so it needs either a virtual output device
 *                the user installs (BlackHole and friends) or a native
 *                ScreenCaptureKit addon, which would reintroduce the
 *                per-platform compiled module this project has avoided.
 *
 *   transcription Xenova/whisper-tiny.en through the same transformers.js
 *                runtime the embedder already uses, in its own utility
 *                process, fed 16kHz mono PCM in ~30s windows.
 */

const PLATFORM_NOTE: Partial<Record<NodeJS.Platform, string>> = {
  darwin:
    'Microphone works. System audio needs a virtual output device (e.g. BlackHole) — macOS has no loopback.',
  win32: 'Microphone and system audio both work through WASAPI loopback.',
  linux: 'Microphone and system audio both work through the PulseAudio monitor source.',
};

const source: CaptureSource = {
  id: 'audio',
  label: 'Meetings & audio',
  description:
    'Transcribes what you say and hear, on device. Not capturing yet — this is the next phase.',
  platforms: ['darwin', 'win32', 'linux'],
  permission: 'microphone',
  implemented: false,

  /** Real, live permission state — used by the UI to show what it would need. */
  available() {
    const note = PLATFORM_NOTE[process.platform] ?? '';
    if (process.platform !== 'darwin') {
      return { ok: false, reason: 'Not wired up yet', permission: 'unknown', note };
    }
    let permission = 'unknown';
    try {
      permission = systemPreferences.getMediaAccessStatus('microphone');
    } catch {
      permission = 'unknown';
    }
    return { ok: false, reason: 'Not wired up yet', permission, note };
  },

  /** Prompts for microphone access. Safe to call before capture exists. */
  async requestPermission(): Promise<PermissionResult> {
    if (process.platform !== 'darwin') return { granted: true, status: 'not-required' };
    try {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      return { granted, status: systemPreferences.getMediaAccessStatus('microphone') };
    } catch (err) {
      return {
        granted: false,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  create(): SourceInstance {
    return {
      start() {
        throw new Error('Audio capture is not implemented yet');
      },
      stop() {
        /* nothing running */
      },
      state() {
        return { running: false, captured: 0 };
      },
    };
  },
};

export default source;
