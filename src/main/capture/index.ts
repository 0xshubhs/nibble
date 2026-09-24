import { EventEmitter } from 'events';

import clipboard from './clipboard';
import files from './files';
import media from './media';
import audio from './audio';
import screen from './screen';

import type { Memory } from '../memory';
import type {
  CaptureContext,
  CaptureItem,
  CaptureResult,
  CaptureSource,
  CaptureSourceId,
  PermissionResult,
  Settings,
  SourceInstance,
  SourceView,
} from '../../types';

/**
 * The capture registry.
 *
 * Every source is the same shape, so the UI, the settings and the "forget
 * everything from this source" button work identically whether the source is
 * a clipboard poller or a transcription pipeline. Sources that are not built
 * yet still register, report their real permission state, and say plainly
 * that they are not capturing.
 */

export const SOURCES: CaptureSource[] = [clipboard, files, media, audio, screen];

export interface CaptureDeps {
  memory: Memory;
  settings: () => Settings;
}

interface CaptureEvents {
  changed: [];
  captured: [{ source: string; title: string; chunks: number }];
  log: [string];
}

export interface StartResult {
  ok: boolean;
  error?: string;
}

export class CaptureManager extends EventEmitter<CaptureEvents> {
  private readonly memory: Memory;
  private readonly settings: () => Settings;
  private instances = new Map<CaptureSourceId, SourceInstance>();
  paused = false;
  log: Array<{ ts: number; msg: string }> = [];

  constructor({ memory, settings }: CaptureDeps) {
    super();
    this.memory = memory;
    this.settings = settings;
  }

  /** Source definitions plus live state, for the UI. */
  list(): SourceView[] {
    return SOURCES.map((def) => {
      const supported = def.platforms.includes(process.platform);
      const inst = this.instances.get(def.id);
      return {
        id: def.id,
        label: def.label,
        description: def.description,
        implemented: def.implemented,
        supported,
        permission: def.permission,
        available: supported
          ? def.available()
          : { ok: false, reason: 'Not available on this platform' },
        enabled: Boolean(this.settings().captureSources?.[def.id]),
        state: inst ? inst.state() : { running: false, captured: 0 },
      };
    });
  }

  /**
   * What media is playing right now, if that source is running -- read fresh
   * on every capture rather than cached, because a clipboard item captured a
   * minute after the last poll should still link to what was on a moment
   * ago, not to a stale reading from when the app started.
   *
   * Public because quick capture and the manual "remember" call go straight
   * to the memory store rather than through this class's own `capture()`, so
   * they need to ask for this the same way.
   */
  nowPlaying(): { app: string; title: string; artist: string } | null {
    const np = this.instances.get('media')?.state().nowPlaying;
    return np?.title ? { app: np.app, title: np.title, artist: np.artist } : null;
  }

  private context(): CaptureContext {
    return {
      capture: (item: CaptureItem): CaptureResult => {
        // The pause switch is checked here, at the last moment, so a source
        // that is mid-poll cannot slip something past it.
        if (this.paused) return { added: 0, skipped: 'paused' };
        // The soundtrack, folded into anything but media's own capture of
        // itself -- a track does not need to cross-link to itself.
        if (item.source !== 'media') {
          const playing = this.nowPlaying();
          if (playing) item = { ...item, meta: { ...(item.meta ?? {}), nowPlaying: playing } };
        }
        const res = this.memory.capture(item);
        if (res.added) {
          this.emit('captured', {
            source: item.source,
            title: item.title ?? '',
            chunks: res.added,
          });
        }
        return res;
      },
      log: (msg: string): void => {
        this.log.unshift({ ts: Date.now(), msg });
        this.log.length = Math.min(this.log.length, 100);
        this.emit('log', msg);
      },
      changed: (): void => {
        this.emit('changed');
      },
    };
  }

  start(id: CaptureSourceId): StartResult {
    const def = SOURCES.find((s) => s.id === id);
    if (!def) return { ok: false, error: 'unknown source' };
    if (!def.platforms.includes(process.platform)) {
      return { ok: false, error: 'not supported on this platform' };
    }
    if (!def.implemented) return { ok: false, error: `${def.label} is not wired up yet` };
    if (this.instances.has(id)) return { ok: true };

    const inst = def.create({ settings: this.settings });
    try {
      inst.start(this.context());
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    this.instances.set(id, inst);
    this.emit('changed');
    return { ok: true };
  }

  stop(id: CaptureSourceId): StartResult {
    const inst = this.instances.get(id);
    if (!inst) return { ok: true };
    try {
      inst.stop();
    } catch {
      /* a source that throws on stop is still stopped as far as we care */
    }
    this.instances.delete(id);
    this.emit('changed');
    return { ok: true };
  }

  /** Brings running sources in line with the enabled flags in settings. */
  sync(): void {
    const enabled = this.settings().captureSources ?? {};
    for (const def of SOURCES) {
      const want =
        Boolean(enabled[def.id]) && def.implemented && def.platforms.includes(process.platform);
      const have = this.instances.has(def.id);
      if (want && !have) this.start(def.id);
      else if (!want && have) this.stop(def.id);
    }
  }

  /** Tells a running source its configuration changed (e.g. the folder list). */
  refresh(id: CaptureSourceId): void {
    this.instances.get(id)?.refresh?.();
  }

  /**
   * The stop-everything switch. Sources keep running but nothing they produce
   * is stored, so resuming does not need a restart.
   */
  setPaused(paused: boolean): boolean {
    this.paused = Boolean(paused);
    this.emit('changed');
    return this.paused;
  }

  async requestPermission(id: CaptureSourceId): Promise<PermissionResult> {
    const def = SOURCES.find((s) => s.id === id);
    if (!def?.requestPermission) return { granted: true, status: 'not-required' };
    return def.requestPermission();
  }

  stopAll(): void {
    for (const id of [...this.instances.keys()]) this.stop(id);
  }
}
