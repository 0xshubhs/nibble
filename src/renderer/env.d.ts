import type {
  CaptureSourceId,
  McpInfo,
  Reminder,
  RendererApi,
  SearchHit,
  Snapshot,
  SourceView,
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
  type AppSourceId = CaptureSourceId;
}

export {};
