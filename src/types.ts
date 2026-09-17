/**
 * The shapes that cross a boundary: main to renderer, capture to memory,
 * MCP to the scheduler. Anything used by exactly one module stays in that
 * module; this file is only for the vocabulary that is genuinely shared.
 */

/* ---------------- reminders ---------------- */

export type Repeat = 'none' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom';

export interface Reminder {
  id: string;
  title: string;
  body: string;
  /** Epoch ms of the next scheduled fire. */
  at: number;
  repeat: Repeat;
  /** Only meaningful when repeat is 'custom'. */
  intervalMinutes: number;
  enabled: boolean;
  /** Overrides `at` until a tick consumes it. */
  snoozedUntil: number | null;
  createdAt: number;
  lastFiredAt: number | null;
}

/** What the UI and the MCP tool both send in; the id is absent when creating. */
export interface ReminderInput {
  id?: string | null;
  title?: string;
  body?: string;
  at: number;
  repeat?: string;
  intervalMinutes?: number;
  enabled?: boolean;
}

/* ---------------- settings ---------------- */

export type CaptureSourceId = 'clipboard' | 'files' | 'audio' | 'screen';

export type EmbedBackend = 'local' | 'cloud';
export type EmbedProvider = 'gemini' | 'voyage';

export interface Settings {
  launchAtLogin: boolean;
  startHidden: boolean;
  showInDock: boolean;
  notificationSound: boolean;
  snoozeMinutes: number;

  captureSources: Record<CaptureSourceId, boolean>;
  memoryFolders: string[];
  capturePaused: boolean;
  allowModelDownload: boolean;
  embedBackend: EmbedBackend;
  embedProvider: EmbedProvider;
  embedApiKey: string;
  /** 0 means keep forever. */
  retentionDays: number;
  /** 0 means no cap. */
  maxChunks: number;

  mcpEnabled: boolean;
  mcpPort: number;
  mcpToken: string;
}

export interface StoreData {
  reminders: Reminder[];
  settings: Settings;
}

/* ---------------- memory ---------------- */

export interface ChunkMeta {
  offset?: number;
  part?: number;
  parts?: number;
  path?: string;
  [key: string]: unknown;
}

/** A stored chunk. `row` and `embedded` are derived at load, never persisted. */
export interface MemoryRecord {
  id: string;
  source: string;
  kind: string;
  title: string;
  text: string;
  ts: number;
  meta: ChunkMeta;
  row: number;
  embedded: boolean;
}

/** What `add()` accepts: everything but the derived fields. */
export interface MemoryInput {
  id: string;
  source: string;
  kind?: string;
  title?: string;
  text: string;
  ts?: number;
  meta?: ChunkMeta;
}

/** What a capture source hands to the memory. */
export interface CaptureItem {
  source: string;
  text: string;
  title?: string;
  kind?: string;
  ts?: number;
  meta?: ChunkMeta;
}

export interface CaptureResult {
  added: number;
  skipped: string | null;
}

/** Which method surfaced a hit -- shown as a pill in the UI. */
export type MatchKind = 'both' | 'meaning' | 'words';

export interface SearchHit {
  id: string;
  source: string;
  kind: string;
  title: string;
  text: string;
  ts: number;
  meta: ChunkMeta;
  score: number;
  matched: MatchKind;
}

export interface SearchOptions {
  k?: number;
  pool?: number;
  since?: number | null;
  source?: string | null;
}

/**
 * What the embedder and the memory both report upward. `error` is nullable
 * rather than optional because the embedder clears it by setting null, and
 * the two have to be the same shape to be re-emitted without translation.
 */
export interface StatusEvent {
  status: string;
  error?: string | null;
}

export interface EmbedderState {
  backend: EmbedBackend;
  provider: EmbedProvider;
  hasKey: boolean;
  ready: boolean;
  status: string;
  progress: number;
  dim: number;
  model: string;
  error: string | null;
}

export interface MemoryStats {
  chunks: number;
  embedded: number;
  pending: number;
  tombstones: number;
  textBytes: number;
  vectorBytes: number;
  model: string | null;
  dim: number;
}

export interface MemoryStatsWithEmbedder extends MemoryStats {
  embedder: EmbedderState;
}

/* ---------------- capture ---------------- */

export interface SourceAvailability {
  ok: boolean;
  reason?: string;
  permission?: string;
  note?: string;
}

/** The context a running source uses to report what it found. */
export interface CaptureContext {
  capture(item: CaptureItem): CaptureResult;
  log(message: string): void;
}

export interface SourceInstanceState {
  running: boolean;
  captured: number;
  skipped?: number;
  folders?: number;
}

export interface SourceInstance {
  start(ctx: CaptureContext): void;
  stop(): void;
  state(): SourceInstanceState;
  /** Called when the source's configuration changed, e.g. the folder list. */
  refresh?(): void;
}

export interface SourceDeps {
  settings: () => Settings;
}

/**
 * A capture source. Sources that are not built yet still implement this and
 * report `implemented: false`, so the UI can list them honestly rather than
 * hiding them or implying they are recording.
 */
export interface CaptureSource {
  id: CaptureSourceId;
  label: string;
  description: string;
  platforms: NodeJS.Platform[];
  permission: 'microphone' | 'screen' | null;
  implemented: boolean;
  available(): SourceAvailability;
  create(deps: SourceDeps): SourceInstance;
  requestPermission?(): Promise<PermissionResult>;
}

export interface PermissionResult {
  granted: boolean;
  status: string;
  error?: string;
  needsRelaunch?: boolean;
}

/** A source plus its live state, as the UI receives it. */
export interface SourceView {
  id: CaptureSourceId;
  label: string;
  description: string;
  implemented: boolean;
  supported: boolean;
  permission: 'microphone' | 'screen' | null;
  available: SourceAvailability;
  enabled: boolean;
  state: SourceInstanceState;
}

/* ---------------- mcp ---------------- */

export interface McpInfo {
  running: boolean;
  port: number | null;
  token: string | null;
  url: string | null;
  error: string | null;
  calls: Array<{ ts: number; name: string; args: unknown }>;
}

/* ---------------- the state the window renders ---------------- */

export interface AppMeta {
  version: string;
  name: string;
  platform: NodeJS.Platform;
  portable: boolean;
  dataDir: string;
  notifications: boolean;
  /** Absolute path to the stdio relay, for the connect instructions. */
  relay: string;
}

export interface MemoryView {
  stats: MemoryStatsWithEmbedder;
  sources: SourceView[];
  paused: boolean;
  mcp: McpInfo;
}

export interface Snapshot {
  reminders: Reminder[];
  settings: Settings;
  meta: AppMeta;
  memory: MemoryView | null;
}

/* ---------------- the preload bridge ---------------- */

export interface CaptureToggleResult {
  ok: boolean;
  error?: string;
  sources: SourceView[];
}

export interface BackendConfig {
  backend?: EmbedBackend;
  provider?: EmbedProvider;
  apiKey?: string;
}

/**
 * Every call the renderer can make. Implemented in preload.ts and consumed
 * through `window.api`, so a change here is a type error on both sides.
 */
export interface RendererApi {
  getState(): Promise<Snapshot>;

  saveReminder(input: ReminderInput): Promise<Reminder>;
  deleteReminder(id: string): Promise<boolean>;
  toggleReminder(id: string, enabled: boolean): Promise<Reminder | null>;
  snoozeReminder(id: string, minutes: number): Promise<Reminder | null>;
  testNotification(id: string | null): Promise<boolean>;

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<Settings>;

  searchMemory(query: string, opts?: SearchOptions): Promise<SearchHit[]>;
  recentMemory(limit?: number, source?: string | null): Promise<SearchHit[]>;
  memoryStats(): Promise<MemoryStatsWithEmbedder>;
  captureNote(item: { text: string; title?: string }): Promise<CaptureResult>;
  forget(id: string): Promise<boolean>;
  forgetSource(source: string): Promise<number>;
  compactMemory(): Promise<number>;
  setEmbedBackend(cfg: BackendConfig): Promise<MemoryStatsWithEmbedder>;

  setCapture(id: CaptureSourceId, enabled: boolean): Promise<CaptureToggleResult>;
  setPaused(paused: boolean): Promise<boolean>;
  requestCapturePermission(id: CaptureSourceId): Promise<PermissionResult>;
  addFolder(): Promise<string[]>;
  removeFolder(folder: string): Promise<string[]>;

  setMcp(enabled: boolean): Promise<McpInfo>;
  regenerateMcpToken(): Promise<McpInfo>;

  revealData(): Promise<string>;
  quit(): Promise<void>;

  /** Both return an unsubscribe function. */
  onState(cb: (state: Snapshot) => void): () => void;
  onFocusReminder(cb: (id: string) => void): () => void;
}
