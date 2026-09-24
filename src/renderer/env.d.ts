import type {
  AskTurn,
  CalendarAgenda,
  CaptureSourceId,
  ClipboardEntry,
  NowPlaying,
  McpInfo,
  NoteItem,
  Reminder,
  RendererApi,
  ScratchpadState,
  SearchHit,
  ShelfItem,
  Snapshot,
  SourceView,
  StatsSnapshot,
  TimerKind,
  TimersState,
  WeatherSnapshot,
} from '../types';

/**
 * The renderer is a plain script, not a module -- it has no imports, so tsc
 * emits it without a CommonJS wrapper and a <script src> can load it directly.
 * Everything it needs therefore has to arrive as an ambient global.
 */
declare global {
  interface Window {
    api: RendererApi;
  }

  type AppSnapshot = Snapshot;
  type AppReminder = Reminder;
  type AppHit = SearchHit;
  type AppSourceView = SourceView;
  type AppMcpInfo = McpInfo;
  type AppNowPlaying = NowPlaying;
  type AppSourceId = CaptureSourceId;

  // --- notch tools ---
  type AppTimerKind = TimerKind;
  type AppTimersState = TimersState;
  type AppClipboardEntry = ClipboardEntry;
  type AppShelfItem = ShelfItem;
  type AppStatsSnapshot = StatsSnapshot;
  type AppCalendarAgenda = CalendarAgenda;
  type AppScratchpadState = ScratchpadState;
  type AppNoteItem = NoteItem;
  type AppWeatherSnapshot = WeatherSnapshot;
  type AppAskTurn = AskTurn;
}

export {};
