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
  // Not an IPC call: webUtils resolves the path synchronously in the preload,
  // which is the only place with the privilege to do it.
  pathForFile: (file) => webUtils.getPathForFile(file),
  rememberFiles: (paths) => ipcRenderer.invoke('memory:remember-files', paths),
  showWindow: () => ipcRenderer.invoke('app:show-window'),

  revealData: () => ipcRenderer.invoke('app:reveal-data'),
  quit: () => ipcRenderer.invoke('app:quit'),

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
  onNotchGeometry: (cb) => {
    const h = (
      _e: Electron.IpcRendererEvent,
      g: { menuBarHeight: number; notchWidth: number }
    ): void => cb(g);
    ipcRenderer.on('notch:geometry', h);
    return () => ipcRenderer.off('notch:geometry', h);
  },
};

contextBridge.exposeInMainWorld('api', api);
