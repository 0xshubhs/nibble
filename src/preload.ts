import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { RendererApi } from './types';

/**
 * The only surface the renderer gets. Node stays off, context isolation
 * stays on, and every call is an explicit, named channel.
 *
 * Typing this as RendererApi is what keeps the two sides honest: the same
 * interface is what `window.api` is declared as in the renderer, so adding a
 * channel on one side without the other is a compile error.
 */
const api: RendererApi = {
  getState: () => ipcRenderer.invoke('state:get'),

  saveReminder: (input) => ipcRenderer.invoke('reminder:save', input),
  deleteReminder: (id) => ipcRenderer.invoke('reminder:delete', id),
  toggleReminder: (id, enabled) => ipcRenderer.invoke('reminder:toggle', id, enabled),
  snoozeReminder: (id, minutes) => ipcRenderer.invoke('reminder:snooze', id, minutes),
  testNotification: (id) => ipcRenderer.invoke('reminder:test', id),

  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),

  // --- memory ---
  searchMemory: (query, opts) => ipcRenderer.invoke('memory:search', query, opts),
  recentMemory: (limit, source) => ipcRenderer.invoke('memory:recent', limit, source),
  relatedMemory: (id, limit) => ipcRenderer.invoke('memory:related', id, limit),
  memoryStats: () => ipcRenderer.invoke('memory:stats'),
  captureNote: (item) => ipcRenderer.invoke('memory:capture', item),
  forget: (id) => ipcRenderer.invoke('memory:forget', id),
  forgetSource: (source) => ipcRenderer.invoke('memory:forget-source', source),
  compactMemory: () => ipcRenderer.invoke('memory:compact'),
  setEmbedBackend: (cfg) => ipcRenderer.invoke('memory:set-backend', cfg),

  // --- capture sources ---
  setCapture: (id, enabled) => ipcRenderer.invoke('capture:set', id, enabled),
  setPaused: (paused) => ipcRenderer.invoke('capture:pause', paused),
  requestCapturePermission: (id) => ipcRenderer.invoke('capture:permission', id),
  addFolder: () => ipcRenderer.invoke('capture:add-folder'),
  removeFolder: (folder) => ipcRenderer.invoke('capture:remove-folder', folder),

  // --- mcp connector ---
  setMcp: (enabled) => ipcRenderer.invoke('mcp:set', enabled),
  regenerateMcpToken: () => ipcRenderer.invoke('mcp:regenerate'),

  // --- notch panel ---
  setNotch: (enabled) => ipcRenderer.invoke('notch:set', enabled),
  closeNotch: () => ipcRenderer.invoke('notch:collapse'),

  // --- recall overlay ---
  closeRecall: () => ipcRenderer.invoke('recall:close'),
  openMemory: (query) => ipcRenderer.invoke('recall:open-memory', query),

  // Not an IPC call: webUtils resolves the path synchronously in the preload,
  // which is the only place with the privilege to do it.
  pathForFile: (file) => webUtils.getPathForFile(file),
  rememberFiles: (paths) => ipcRenderer.invoke('memory:remember-files', paths),
  showWindow: () => ipcRenderer.invoke('app:show-window'),

  revealData: () => ipcRenderer.invoke('app:reveal-data'),
  quit: () => ipcRenderer.invoke('app:quit'),

  // --- notch tools ---

  clipboardList: (query) => ipcRenderer.invoke('tools:clipboard:list', query),
  clipboardCopy: (id) => ipcRenderer.invoke('tools:clipboard:copy', id),
  clipboardPin: (id, pinned) => ipcRenderer.invoke('tools:clipboard:pin', id, pinned),
  clipboardRemove: (id) => ipcRenderer.invoke('tools:clipboard:remove', id),
  clipboardClear: () => ipcRenderer.invoke('tools:clipboard:clear'),

  shelfList: () => ipcRenderer.invoke('tools:shelf:list'),
  shelfAdd: (paths) => ipcRenderer.invoke('tools:shelf:add', paths),
  shelfRemove: (id) => ipcRenderer.invoke('tools:shelf:remove', id),
  // Fire-and-forget: startDrag has to be called synchronously from the main
  // process's handling of the native dragstart, not awaited from the renderer.
  shelfStartDrag: (id) => ipcRenderer.send('tools:shelf:drag-start', id),

  timersGet: () => ipcRenderer.invoke('tools:timers:get'),
  timersStart: (kind) => ipcRenderer.invoke('tools:timers:start', kind),
  timersPause: () => ipcRenderer.invoke('tools:timers:pause'),
  timersReset: (kind) => ipcRenderer.invoke('tools:timers:reset', kind),
  timersSetCountdown: (seconds) => ipcRenderer.invoke('tools:timers:set-countdown', seconds),
  timersSetHydration: (enabled, minutes) =>
    ipcRenderer.invoke('tools:timers:set-hydration', enabled, minutes),

  statsSubscribe: () => ipcRenderer.invoke('tools:stats:subscribe'),
  statsUnsubscribe: () => ipcRenderer.invoke('tools:stats:unsubscribe'),

  calendarAgenda: (days) => ipcRenderer.invoke('tools:calendar:agenda', days),
  calendarCompleteReminder: (id) => ipcRenderer.invoke('tools:calendar:complete-reminder', id),

  scratchpadGet: () => ipcRenderer.invoke('tools:scratchpad:get'),
  scratchpadSet: (text) => ipcRenderer.invoke('tools:scratchpad:set', text),
  scratchpadPin: (pinned) => ipcRenderer.invoke('tools:scratchpad:pin', pinned),

  notesList: () => ipcRenderer.invoke('tools:notes:list'),
  notesCreate: () => ipcRenderer.invoke('tools:notes:create'),
  notesUpdate: (id, patch) => ipcRenderer.invoke('tools:notes:update', id, patch),
  notesRemove: (id) => ipcRenderer.invoke('tools:notes:remove', id),

  weatherGet: () => ipcRenderer.invoke('tools:weather:get'),
  weatherSetLocation: (query) => ipcRenderer.invoke('tools:weather:set-location', query),

  askList: () => ipcRenderer.invoke('tools:ask:list'),
  askQuestion: (question) => ipcRenderer.invoke('tools:ask:ask', question),
  askClear: () => ipcRenderer.invoke('tools:ask:clear'),

  runMessage: (text) => ipcRenderer.invoke('tools:message:run', text),

  onState: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, state: Parameters<typeof cb>[0]): void => cb(state);
    ipcRenderer.on('state', h);
    return () => ipcRenderer.off('state', h);
  },
  onFocusReminder: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, id: string): void => cb(id);
    ipcRenderer.on('focus-reminder', h);
    return () => ipcRenderer.off('focus-reminder', h);
  },
  onFocusSearch: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, query: string): void => cb(query);
    ipcRenderer.on('focus-search', h);
    return () => ipcRenderer.off('focus-search', h);
  },
  onRecallShown: (cb) => {
    const h = (): void => cb();
    ipcRenderer.on('recall:shown', h);
    return () => ipcRenderer.off('recall:shown', h);
  },
  onNotchExpanded: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, on: boolean): void => cb(on);
    ipcRenderer.on('notch:expanded', h);
    return () => ipcRenderer.off('notch:expanded', h);
  },
  onNotchPulse: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, label: string): void => cb(label);
    ipcRenderer.on('notch:pulse', h);
    return () => ipcRenderer.off('notch:pulse', h);
  },
  onNotchMessage: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, payload: Parameters<typeof cb>[0]): void => cb(payload);
    ipcRenderer.on('notch:message', h);
    return () => ipcRenderer.off('notch:message', h);
  },
  onNotchGeometry: (cb) => {
    const h = (
      _e: Electron.IpcRendererEvent,
      g: { menuBarHeight: number; notchWidth: number }
    ): void => cb(g);
    ipcRenderer.on('notch:geometry', h);
    return () => ipcRenderer.off('notch:geometry', h);
  },
  onTimersTick: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, state: Parameters<typeof cb>[0]): void => cb(state);
    ipcRenderer.on('tools:timers:tick', h);
    return () => ipcRenderer.off('tools:timers:tick', h);
  },
  onStatsTick: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, snapshot: Parameters<typeof cb>[0]): void =>
      cb(snapshot);
    ipcRenderer.on('tools:stats:tick', h);
    return () => ipcRenderer.off('tools:stats:tick', h);
  },
};

contextBridge.exposeInMainWorld('api', api);
