'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { dataPath } = require('./paths');

const DEFAULTS = {
  reminders: [],
  settings: {
    launchAtLogin: false,
    startHidden: true,
    showInDock: process.platform !== 'darwin',
    notificationSound: true,
    snoozeMinutes: 10,

    // --- memory ---
    captureSources: { clipboard: false, files: false, audio: false, screen: false },
    memoryFolders: [],
    capturePaused: false,
    allowModelDownload: true,
    embedBackend: 'local',       // 'local' | 'cloud'
    embedProvider: 'gemini',     // when cloud
    embedApiKey: '',
    retentionDays: 0,            // 0 = keep forever
    maxChunks: 0,                // 0 = no cap

    // --- mcp connector ---
    mcpEnabled: false,
    mcpPort: 8787,
    mcpToken: '',
  },
};

/**
 * A tiny JSON store. Writes go through a temp file + rename so a crash
 * mid-write cannot leave a truncated config behind.
 */
class Store extends EventEmitter {
  constructor() {
    super();
    this.file = path.join(dataPath().dir, 'store.json');
    this.data = this._read();
  }

  _read() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        reminders: Array.isArray(raw.reminders) ? raw.reminders : [],
        settings: { ...DEFAULTS.settings, ...(raw.settings || {}) },
      };
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  _write() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  save() {
    this._write();
    this.emit('changed', this.data);
  }

  get reminders() {
    return this.data.reminders;
  }

  get settings() {
    return this.data.settings;
  }

  setSetting(key, value) {
    if (!(key in DEFAULTS.settings)) throw new Error(`unknown setting: ${key}`);
    this.data.settings[key] = value;
    this.save();
    return this.data.settings;
  }

  upsert(reminder) {
    const i = this.data.reminders.findIndex((r) => r.id === reminder.id);
    if (i === -1) this.data.reminders.push(reminder);
    else this.data.reminders[i] = reminder;
    this.save();
    return reminder;
  }

  remove(id) {
    const before = this.data.reminders.length;
    this.data.reminders = this.data.reminders.filter((r) => r.id !== id);
    if (this.data.reminders.length !== before) this.save();
  }

  find(id) {
    return this.data.reminders.find((r) => r.id === id) || null;
  }
}

module.exports = { Store, DEFAULTS };
