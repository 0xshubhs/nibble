'use strict';
const { EventEmitter } = require('events');

const clipboard = require('./clipboard');
const files = require('./files');
const audio = require('./audio');
const screen = require('./screen');

/**
 * The capture registry.
 *
 * Every source is the same shape, so the UI, the settings and the "forget
 * everything from this source" button work identically whether the source is
 * a clipboard poller or a transcription pipeline. Sources that are not built
 * yet still register, report their real permission state, and say plainly
 * that they are not capturing.
 */

const SOURCES = [clipboard, files, audio, screen];

class CaptureManager extends EventEmitter {
  /**
   * @param {object} deps
   * @param {import('../memory')} deps.memory
   * @param {() => object} deps.settings   reads current settings
   */
  constructor({ memory, settings }) {
    super();
    this.memory = memory;
    this.settings = settings;
    this.instances = new Map();
    this.paused = false;
    this.log = [];
  }

  /** Source definitions plus live state, for the UI. */
  list() {
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
        available: supported ? def.available() : { ok: false, reason: 'Not available on this platform' },
        enabled: Boolean(this.settings().captureSources?.[def.id]),
        state: inst ? inst.state() : { running: false, captured: 0 },
      };
    });
  }

  _context() {
    return {
      capture: (item) => {
        // The pause switch is checked here, at the last moment, so a source
        // that is mid-poll cannot slip something past it.
        if (this.paused) return { added: 0, skipped: 'paused' };
        const res = this.memory.capture(item);
        if (res.added) this.emit('captured', { source: item.source, title: item.title, chunks: res.added });
        return res;
      },
      log: (msg) => {
        this.log.unshift({ ts: Date.now(), msg });
        this.log.length = Math.min(this.log.length, 100);
        this.emit('log', msg);
      },
    };
  }

  start(id) {
    const def = SOURCES.find((s) => s.id === id);
    if (!def) return { ok: false, error: 'unknown source' };
    if (!def.platforms.includes(process.platform)) return { ok: false, error: 'not supported on this platform' };
    if (!def.implemented) return { ok: false, error: `${def.label} is not wired up yet` };
    if (this.instances.has(id)) return { ok: true };

    const inst = def.create({ settings: this.settings });
    try {
      inst.start(this._context());
    } catch (err) {
      return { ok: false, error: err.message };
    }
    this.instances.set(id, inst);
    this.emit('changed');
    return { ok: true };
  }

  stop(id) {
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
  sync() {
    const enabled = this.settings().captureSources || {};
    for (const def of SOURCES) {
      const want = Boolean(enabled[def.id]) && def.implemented && def.platforms.includes(process.platform);
      const have = this.instances.has(def.id);
      if (want && !have) this.start(def.id);
      else if (!want && have) this.stop(def.id);
    }
  }

  /** Tells a running source its configuration changed (e.g. the folder list). */
  refresh(id) {
    const inst = this.instances.get(id);
    if (inst && typeof inst.refresh === 'function') inst.refresh();
  }

  /**
   * The stop-everything switch. Sources keep running but nothing they produce
   * is stored, so resuming does not need a restart.
   */
  setPaused(paused) {
    this.paused = Boolean(paused);
    this.emit('changed');
    return this.paused;
  }

  async requestPermission(id) {
    const def = SOURCES.find((s) => s.id === id);
    if (!def || typeof def.requestPermission !== 'function') {
      return { granted: true, status: 'not-required' };
    }
    return def.requestPermission();
  }

  stopAll() {
    for (const id of [...this.instances.keys()]) this.stop(id);
  }
}

module.exports = { CaptureManager, SOURCES };
