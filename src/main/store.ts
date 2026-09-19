import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { dataPath } from './paths';
import { DEFAULT_SHORTCUT } from './quickcapture';
import type { Reminder, Settings, StoreData } from '../types';

export const DEFAULTS: StoreData = {
  reminders: [],
  settings: {
    launchAtLogin: false,
    startHidden: true,
    showInDock: process.platform !== 'darwin',
    notificationSound: true,
    snoozeMinutes: 10,

    // --- memory ---
    captureSources: { clipboard: false, files: false, media: false, audio: false, screen: false },
    memoryFolders: [],
    capturePaused: false,
    allowModelDownload: true,
    embedBackend: 'local',
    embedProvider: 'gemini',
    embedApiKey: '',
    retentionDays: 0,
    maxChunks: 0,

    // --- mcp connector ---
    mcpEnabled: false,
    mcpPort: 8787,
    mcpToken: '',

    // --- quick capture ---
    quickCaptureEnabled: false,
    quickCaptureShortcut: DEFAULT_SHORTCUT,

    // --- notch panel ---
    notchEnabled: false,
    notchWidth: 200,
  },
};

interface StoreEvents {
  changed: [StoreData];
}

/**
 * A tiny JSON store. Writes go through a temp file + rename so a crash
 * mid-write cannot leave a truncated config behind.
 */
export class Store extends EventEmitter<StoreEvents> {
  readonly file: string;
  data: StoreData;

  constructor() {
    super();
    this.file = path.join(dataPath().dir, 'store.json');
    this.data = this.read();
  }

  private read(): StoreData {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<StoreData>;
      return {
        reminders: Array.isArray(raw.reminders) ? raw.reminders : [],
        settings: { ...DEFAULTS.settings, ...(raw.settings ?? {}) },
      };
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  private write(): void {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  save(): void {
    this.write();
    this.emit('changed', this.data);
  }

  get reminders(): Reminder[] {
    return this.data.reminders;
  }

  get settings(): Settings {
    return this.data.settings;
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Settings {
    if (!(key in DEFAULTS.settings)) throw new Error(`unknown setting: ${String(key)}`);
    this.data.settings[key] = value;
    this.save();
    return this.data.settings;
  }

  upsert(reminder: Reminder): Reminder {
    const i = this.data.reminders.findIndex((r) => r.id === reminder.id);
    if (i === -1) this.data.reminders.push(reminder);
    else this.data.reminders[i] = reminder;
    this.save();
    return reminder;
  }

  remove(id: string): void {
    const before = this.data.reminders.length;
    this.data.reminders = this.data.reminders.filter((r) => r.id !== id);
    if (this.data.reminders.length !== before) this.save();
  }

  find(id: string): Reminder | null {
    return this.data.reminders.find((r) => r.id === id) ?? null;
  }
}
