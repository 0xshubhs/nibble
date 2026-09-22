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

export type CaptureSourceId = 'clipboard' | 'files' | 'media' | 'audio' | 'screen';

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

  /** Global hotkey that remembers whatever is on the clipboard. */
  quickCaptureEnabled: boolean;
  quickCaptureShortcut: string;

  /** macOS only: the panel that hangs off the notch. */
  notchEnabled: boolean;
  /**
   * Width of the hover target, in points. macOS exposes the real notch size
   * only through NSScreen.safeAreaInsets, which Electron does not surface, so
   * this is a sane default the user can nudge.
   */
  /**
   * How wide to treat the notch as, in points. Zero means ask the OS, which
   * is almost always better than a number typed in here: the width changes
   * with the display's scaling mode, so there is no constant to hardcode.
   */
  notchWidth: number;
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
  /**
   * Says that `state()` would now answer differently, without anything
   * having been captured. A source that only reported through capture could
   * never show anything it had decided not to store.
   */
  changed?(): void;
}

/** What a player is playing right now, as the panel shows it. */
export interface NowPlaying {
  title: string;
  artist: string;
  album: string;
  url: string;
  /** The player it came from, e.g. Spotify or Brave. */
  app: string;
  /**
   * That player's icon as a PNG data URL, for the circle in the notch.
   * Empty when the platform cannot produce one, which is every platform
   * except macOS, and any bundle that ships no .icns.
   */
  icon?: string;
}

export interface SourceInstanceState {
  running: boolean;
  captured: number;
  skipped?: number;
  folders?: number;
  /**
   * Live, not stored. A source reports this when it knows something the UI
   * should show before anything has been captured -- what is playing is
   * interesting the moment it starts, not thirty seconds later when it is
   * old enough to remember.
   */
  nowPlaying?: NowPlaying | null;
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

export interface NotchCapability {
  /** The platform supports it at all. */
  supported: boolean;
  /** Our best guess that this Mac physically has a notch. */
  likelyNotched: boolean;
  enabled: boolean;
}

/**
 * The global hotkey's real state. `registered` is what the OS accepted, not
 * what the setting asks for: another app may already own the combination, and
 * the UI has to be able to say so instead of showing a switch that lies.
 */
export interface QuickCaptureState {
  enabled: boolean;
  accelerator: string;
  registered: boolean;
  error: string | null;
}

export interface AppMeta {
  version: string;
  name: string;
  platform: NodeJS.Platform;
  portable: boolean;
  dataDir: string;
  notifications: boolean;
  /** Absolute path to the stdio relay, for the connect instructions. */
  relay: string;
  notch: NotchCapability;
  quickCapture: QuickCaptureState;
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

/* ---------------- notch tools ---------------- */
/**
 * Five self-contained utilities that live as tabs in the notch panel,
 * alongside memory search. Each one owns its own storage and its own IPC
 * surface rather than going through the reminders/memory `Snapshot`, because
 * their state changes on a much faster clock (a clipboard poll, a running
 * timer, a system-stats sample) and folding that into the one broadcast that
 * already drives the whole window would mean re-rendering everything in it
 * several times a second for data the window never shows.
 */

export type TimerKind = 'pomodoro' | 'countdown' | 'stopwatch';
export type PomodoroPhase = 'work' | 'break';

export interface TimersState {
  active: TimerKind | null;
  running: boolean;
  /** Seconds left, for pomodoro and countdown; seconds elapsed, for stopwatch. */
  seconds: number;
  pomodoroPhase: PomodoroPhase;
  /** Completed work phases, this session. */
  pomodoroCount: number;
  /** What a countdown was last set to, so resetting it doesn't lose it. */
  countdownTotal: number;
  hydrationEnabled: boolean;
  hydrationMinutes: number;
  /** Epoch ms of the next hydration nudge, or null while it's off. */
  hydrationNextAt: number | null;
}

export interface ClipboardEntry {
  id: string;
  text: string;
  ts: number;
  pinned: boolean;
}

export interface ShelfItem {
  id: string;
  name: string;
  /** Where the copy actually lives on disk, inside app data. */
  path: string;
  size: number;
  addedAt: number;
}

export interface StatSupport {
  disk: boolean;
  battery: boolean;
  network: boolean;
}

export interface StatsSnapshot {
  /** Null on the first sample: CPU load needs two points in time. */
  cpuPercent: number | null;
  memPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
  disk: { usedBytes: number; totalBytes: number; percent: number } | null;
  battery: { percent: number; charging: boolean } | null;
  /** Null on the first sample, and whenever the interface can't be read. */
  network: { upBytesPerSec: number; downBytesPerSec: number; iface: string } | null;
  supported: StatSupport;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  calendar: string;
  allDay: boolean;
}

export interface CalendarReminderItem {
  id: string;
  title: string;
  due: number | null;
  list: string;
}

export interface CalendarAgenda {
  ok: boolean;
  error?: string;
  events: CalendarEvent[];
  reminders: CalendarReminderItem[];
}

export interface ScratchpadState {
  text: string;
  /** Shown on the collapsed strip, the way a played track is. */
  pinned: boolean;
  updatedAt: number;
}

export interface NoteItem {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface WeatherLocation {
  name: string;
  lat: number;
  lon: number;
}

export interface WeatherDay {
  /** YYYY-MM-DD, in the location's own timezone. */
  date: string;
  max: number;
  min: number;
  code: number;
}

export interface WeatherSnapshot {
  ok: boolean;
  error?: string;
  location: WeatherLocation | null;
  current: { temp: number; code: number } | null;
  daily: WeatherDay[];
  fetchedAt: number | null;
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
  relatedMemory(id: string, limit?: number): Promise<SearchHit[]>;
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

  setNotch(enabled: boolean): Promise<boolean>;
  /**
   * The notch panel asking to be collapsed, from Escape or a click on its own
   * close affordance. It has to go through the main process: the renderer can
   * hide its own body, but only main can stop the window swallowing clicks.
   */
  closeNotch(): Promise<void>;

  /**
   * A sandboxed renderer gets no usable path off a dropped File, so the
   * preload resolves it through webUtils and the main process reads it.
   */
  pathForFile(file: File): string;
  rememberFiles(paths: string[]): Promise<number>;
  showWindow(): Promise<void>;

  revealData(): Promise<string>;
  quit(): Promise<void>;

  // --- notch tools ---

  clipboardList(query?: string): Promise<ClipboardEntry[]>;
  clipboardCopy(id: string): Promise<boolean>;
  clipboardPin(id: string, pinned: boolean): Promise<ClipboardEntry[]>;
  clipboardRemove(id: string): Promise<ClipboardEntry[]>;
  clipboardClear(): Promise<ClipboardEntry[]>;

  shelfList(): Promise<ShelfItem[]>;
  shelfAdd(paths: string[]): Promise<ShelfItem[]>;
  shelfRemove(id: string): Promise<ShelfItem[]>;
  /** Fire-and-forget: tells main to start an OS-level file drag for this item. */
  shelfStartDrag(id: string): void;

  timersGet(): Promise<TimersState>;
  timersStart(kind: TimerKind): Promise<TimersState>;
  timersPause(): Promise<TimersState>;
  timersReset(kind: TimerKind): Promise<TimersState>;
  timersSetCountdown(seconds: number): Promise<TimersState>;
  timersSetHydration(enabled: boolean, minutes: number): Promise<TimersState>;

  statsSubscribe(): Promise<StatsSnapshot>;
  statsUnsubscribe(): Promise<void>;

  calendarAgenda(days?: number): Promise<CalendarAgenda>;
  calendarCompleteReminder(id: string): Promise<boolean>;

  scratchpadGet(): Promise<ScratchpadState>;
  scratchpadSet(text: string): Promise<ScratchpadState>;
  scratchpadPin(pinned: boolean): Promise<ScratchpadState>;

  notesList(): Promise<NoteItem[]>;
  notesCreate(): Promise<NoteItem[]>;
  notesUpdate(id: string, patch: { title?: string; body?: string }): Promise<NoteItem[]>;
  notesRemove(id: string): Promise<NoteItem[]>;

  weatherGet(): Promise<WeatherSnapshot>;
  weatherSetLocation(query: string): Promise<WeatherSnapshot>;

  /** Runs a message across the collapsed strip -- the notch's own marquee. */
  runMessage(text: string): Promise<void>;

  /** All of these return an unsubscribe function. */
  onState(cb: (state: Snapshot) => void): () => void;
  onFocusReminder(cb: (id: string) => void): () => void;
  onNotchExpanded(cb: (expanded: boolean) => void): () => void;
  onNotchPulse(cb: (label: string) => void): () => void;
  onNotchMessage(cb: (payload: { text: string; durationMs: number }) => void): () => void;
  onNotchGeometry(cb: (g: { menuBarHeight: number; notchWidth: number }) => void): () => void;
  onTimersTick(cb: (state: TimersState) => void): () => void;
  onStatsTick(cb: (snapshot: StatsSnapshot) => void): () => void;
}
