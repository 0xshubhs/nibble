import path from 'path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  powerMonitor,
  shell,
} from 'electron';

import { initDataPath, dataPath } from './paths';
import { Store } from './store';
import { Scheduler, nextAfter, isRepeat } from './scheduler';
import { AppTray } from './tray';
import * as autostart from './autostart';
import * as notifier from './notifier';
import { Memory } from './memory';
import { CaptureManager } from './capture';
import { McpBridge } from './mcp/server';
import { NotchPanel, notchPaths, likelyNotched } from './notch';
import { QuickCapture, DEFAULT_SHORTCUT } from './quickcapture';
import { isSecret } from './capture/clipboard';
import type {
  BackendConfig,
  CaptureSourceId,
  Reminder,
  ReminderInput,
  SearchOptions,
  Settings,
  Snapshot,
} from '../types';

// Windows needs this before any notification is shown, or toasts are
// attributed to "electron.app.Electron" and may not appear at all.
app.setAppUserModelId('com.zeroxshubhs.nibble');

// Portable storage has to be decided before anything touches userData.
initDataPath();

// A background app must never run twice: two copies would double every
// notification and race on store.json.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let store: Store;
let scheduler: Scheduler;
let tray: AppTray | null = null;
let memory: Memory | null = null;
let capture: CaptureManager | null = null;
let mcp: McpBridge | null = null;
let notch: NotchPanel | null = null;
let quick: QuickCapture | null = null;
let win: BrowserWindow | null = null;
let quitting = false;

/* ---------------- window ---------------- */

function createWindow({ show }: { show: boolean }): BrowserWindow {
  win = new BrowserWindow({
    width: 880,
    height: 660,
    minWidth: 560,
    minHeight: 460,
    show: false,
    title: app.getName(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#ffffff',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // An occluded window otherwise stops producing frames, which makes
      // capturePage return a stale one.
      backgroundThrottling: false,
    },
  });

  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    if (show) win?.show();
    void maybeScreenshot();
  });

  // The close button hides the window; only an explicit Quit really exits.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
    if (process.platform === 'darwin' && !store.settings.showInDock) app.dock?.hide();
  });

  // Anything that is not our own page opens in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

/**
 * Development helper: `--screenshot=<file> [--tab=memory] [--query=...]`
 * renders the window, captures it and exits. Capturing from inside the app
 * beats a screen grab, which picks up whatever else is in front.
 */
async function maybeScreenshot(): Promise<void> {
  if (app.isPackaged) return;
  const arg = process.argv.find((a) => a.startsWith('--screenshot='));
  if (!arg || !win) return;

  const file = arg.slice('--screenshot='.length);
  const tab = (process.argv.find((a) => a.startsWith('--tab=')) ?? '--tab=reminders').slice(6);
  const wait = Number((process.argv.find((a) => a.startsWith('--wait=')) ?? '--wait=1200').slice(7));
  const query = (process.argv.find((a) => a.startsWith('--query=')) ?? '--query=').slice(8);
  const scroll = Number(
    (process.argv.find((a) => a.startsWith('--scroll=')) ?? '--scroll=0').slice(9)
  );

  setTimeout(() => {
    void (async () => {
      try {
        if (!win) return;
        await win.webContents.executeJavaScript(
          `(() => {
             const b = document.querySelector('[data-tab="${tab}"]');
             if (b) b.click();
             const q = ${JSON.stringify(query)};
             if (q) {
               const box = document.getElementById('m-q');
               if (box) { box.value = q; box.dispatchEvent(new Event('input', { bubbles: true })); }
             }
             window.scrollTo(0, ${scroll});
             return true;
           })()`
        );
        // An occluded window composites lazily, so bring it up and give it a
        // beat before capturing or the frame is the previous tab.
        win.showInactive();
        win.moveTop();
        await new Promise((r) => setTimeout(r, 1200));
        const img = await win.webContents.capturePage();
        (await import('fs')).writeFileSync(file, img.toPNG());
        console.log(`SHOT ${file}`);
      } catch (err) {
        console.log(`SHOT_FAIL ${err instanceof Error ? err.message : String(err)}`);
      }
      quitting = true;
      app.exit(0);
    })();
  }, wait);
}

function showWindow(focusId?: string): void {
  if (!win || win.isDestroyed()) createWindow({ show: true });
  if (!win) return;
  if (process.platform === 'darwin') app.dock?.show();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (focusId) win.webContents.send('focus-reminder', focusId);
}

/* ---------------- sync helpers ---------------- */

/**
 * Absolute path to the stdio relay, which is what a client actually spawns.
 * A packaged build ships it as a plain resource rather than inside the asar,
 * because a bare `node` cannot read files out of an archive.
 */
function relayPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'mcp', 'stdio.js');
  return path.join(__dirname, '..', 'mcp', 'stdio.js');
}

function snapshot(): Snapshot {
  return {
    reminders: store.reminders,
    settings: { ...store.settings, launchAtLogin: autostart.isEnabled() },
    meta: {
      version: app.getVersion(),
      name: app.getName(),
      platform: process.platform,
      portable: dataPath().portable,
      dataDir: dataPath().dir,
      notifications: notifier.supported(),
      relay: relayPath(),
      notch: {
        supported: notch?.supported() ?? false,
        likelyNotched: likelyNotched(),
        enabled: store.settings.notchEnabled,
      },
      quickCapture: quick?.state() ?? {
        enabled: false,
        accelerator: store.settings.quickCaptureShortcut || DEFAULT_SHORTCUT,
        registered: false,
        error: null,
      },
    },
    memory:
      memory && capture && mcp
        ? {
            stats: memory.stats(),
            sources: capture.list(),
            paused: capture.paused,
            mcp: mcp.info(),
          }
        : null,
  };
}

function pushState(): void {
  tray?.render();
  const state = snapshot();
  // The webContents can be torn down a beat before the window is, so checking
  // only the window logs "Render frame was disposed" noise on every quit.
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send('state', state);
  }
  notch?.send(state);
}

/* ---------------- reminders ---------------- */

/**
 * The single place a reminder is created or edited. The window and the MCP
 * tool both come through here, so an assistant-scheduled reminder gets exactly
 * the same validation and roll-forward as one typed into the UI.
 */
function saveReminder(input: ReminderInput): Reminder {
  const now = Date.now();
  const existing = input.id ? store.find(input.id) : null;

  const repeat = isRepeat(input.repeat) ? input.repeat : 'none';
  let at = Number(input.at);
  if (!Number.isFinite(at)) throw new Error('invalid time');

  // A time already in the past only makes sense for a repeating reminder,
  // where it anchors the series -- roll it forward to the next real slot.
  if (at <= now) {
    const next = nextAfter(at, now, repeat, input.intervalMinutes);
    if (next !== null) at = next;
  }

  const reminder: Reminder = {
    id: existing?.id ?? `r_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title: String(input.title ?? '').trim() || 'Reminder',
    body: String(input.body ?? '').trim(),
    at,
    repeat,
    intervalMinutes: Math.max(1, Number(input.intervalMinutes) || 60),
    enabled: input.enabled !== false,
    snoozedUntil: null,
    createdAt: existing?.createdAt ?? now,
    lastFiredAt: existing?.lastFiredAt ?? null,
  };

  store.upsert(reminder);
  scheduler.tick();
  pushState();
  return reminder;
}

/* ---------------- quick capture ---------------- */

/** A bare notification with no reminder behind it. */
function toast(title: string, body: string): void {
  notifier.fire({ title, body }, {
    sound: false,
    snoozeMinutes: store.settings.snoozeMinutes,
    onOpen: () => showWindow(),
    onSnooze: () => undefined,
  });
}

/**
 * The hotkey: remember whatever is on the clipboard, right now.
 *
 * This is the deliberate counterpart to the clipboard source. That one is
 * ambient and stores everything while it runs; this stores exactly one thing,
 * because you asked for it, with nothing watching in between.
 */
function rememberClipboard(): void {
  if (!memory) return;

  let text = '';
  try {
    text = clipboard.readText() ?? '';
  } catch {
    text = ''; // another app is holding the pasteboard
  }
  text = text.trim();

  // Nothing worth storing: open the window rather than fail silently, since
  // the key press has to do something visible.
  if (text.length < 8) {
    showWindow();
    return;
  }

  // Pause means nothing is stored. A hotkey is explicit, but someone who
  // paused capture to handle something sensitive is owed the stronger
  // reading, so say no out loud instead of making an exception.
  if (capture?.paused) {
    toast('Capture is paused', 'Nothing was stored. Resume capture in the Memory tab.');
    return;
  }

  if (isSecret(text)) {
    toast('Not remembered', 'That looked like a password or a key.');
    return;
  }

  const title = text.split('\n')[0].slice(0, 80);
  const res = memory.capture({ source: 'quick', kind: 'clipboard', text, title });
  if (res.added) {
    notch?.pulse('Remembered');
    toast('Remembered', title);
  } else {
    toast('Already remembered', 'That is the same thing you saved a moment ago.');
  }
  pushState();
}

/** Keeps the OS registration in step with the two settings that drive it. */
function syncQuickCapture(): void {
  quick?.apply(store.settings.quickCaptureEnabled, store.settings.quickCaptureShortcut);
}

/* ---------------- ipc ---------------- */

function registerIpc(): void {
  ipcMain.handle('state:get', () => snapshot());

  ipcMain.handle('reminder:save', (_e, input: ReminderInput) => saveReminder(input));

  ipcMain.handle('reminder:delete', (_e, id: string) => {
    store.remove(id);
    scheduler.arm();
    pushState();
    return true;
  });

  ipcMain.handle('reminder:toggle', (_e, id: string, enabled: boolean) => {
    const r = store.find(id);
    if (!r) return null;
    r.enabled = Boolean(enabled);
    r.snoozedUntil = null;
    // Re-enabling something whose time has passed re-arms it sensibly.
    if (r.enabled && r.at <= Date.now()) {
      const next = nextAfter(r.at, Date.now(), r.repeat, r.intervalMinutes);
      if (next !== null) r.at = next;
    }
    store.save();
    scheduler.tick();
    pushState();
    return r;
  });

  ipcMain.handle('reminder:snooze', (_e, id: string, minutes: number) => {
    const r = scheduler.snooze(id, Number(minutes) || store.settings.snoozeMinutes);
    pushState();
    return r;
  });

  ipcMain.handle('reminder:test', (_e, id: string | null) => {
    const r = id ? store.find(id) : null;
    notifier.fire(r ?? { title: app.getName(), body: 'Notifications are working.' }, {
      sound: store.settings.notificationSound,
      snoozeMinutes: store.settings.snoozeMinutes,
      onOpen: (rid) => showWindow(rid),
      onSnooze: (rid, m) => {
        scheduler.snooze(rid, m);
        pushState();
      },
    });
    return notifier.supported();
  });

  ipcMain.handle('settings:set', <K extends keyof Settings>(_e: unknown, key: K, value: Settings[K]) => {
    if (key === 'launchAtLogin') {
      autostart.setEnabled(Boolean(value), { hidden: store.settings.startHidden });
      store.setSetting('launchAtLogin', autostart.isEnabled());
    } else {
      store.setSetting(key, value);
      if (key === 'showInDock' && process.platform === 'darwin') {
        if (value) app.dock?.show();
        else if (!win?.isVisible()) app.dock?.hide();
      }
      if (key === 'startHidden' && store.settings.launchAtLogin) {
        // Keep the login item's --hidden flag in step with the preference.
        autostart.setEnabled(true, { hidden: Boolean(value) });
      }
      if (key === 'quickCaptureEnabled' || key === 'quickCaptureShortcut') syncQuickCapture();
    }
    pushState();
    return snapshot().settings;
  });

  /* ---- memory ---- */

  ipcMain.handle('memory:search', (_e, query: string, opts?: SearchOptions) =>
    memory?.search(query, opts ?? {}) ?? []
  );
  ipcMain.handle('memory:recent', (_e, limit?: number, source?: string | null) =>
    memory?.recent(limit ?? 20, source ?? null) ?? []
  );
  ipcMain.handle('memory:related', (_e, id: string, limit?: number) =>
    memory?.related(id, limit ?? 5) ?? []
  );
  ipcMain.handle('memory:stats', () => memory?.stats() ?? null);

  ipcMain.handle('memory:capture', (_e, item: { text: string; title?: string }) => {
    const res = memory?.capture({ source: 'manual', kind: 'note', ...item }) ?? {
      added: 0,
      skipped: 'not-ready',
    };
    pushState();
    return res;
  });

  ipcMain.handle('memory:forget', (_e, id: string) => {
    const ok = memory?.forget(id) ?? false;
    pushState();
    return ok;
  });

  ipcMain.handle('memory:forget-source', (_e, source: string) => {
    const n = memory?.forgetSource(source) ?? 0;
    pushState();
    return n;
  });

  ipcMain.handle('memory:compact', () => {
    const n = memory?.compact() ?? 0;
    pushState();
    return n;
  });

  ipcMain.handle('memory:set-backend', async (_e, cfg: BackendConfig) => {
    if (cfg.backend) store.setSetting('embedBackend', cfg.backend);
    if (cfg.provider) store.setSetting('embedProvider', cfg.provider);
    if (cfg.apiKey !== undefined) store.setSetting('embedApiKey', cfg.apiKey);
    const stats = await memory?.setBackend(cfg);
    pushState();
    return stats ?? null;
  });

  /* ---- capture ---- */

  ipcMain.handle('capture:set', (_e, id: CaptureSourceId, enabled: boolean) => {
    if (!capture) return { ok: false, error: 'capture not ready', sources: [] };
    const sources = { ...store.settings.captureSources, [id]: Boolean(enabled) };
    store.setSetting('captureSources', sources);
    const res = enabled ? capture.start(id) : capture.stop(id);
    if (!res.ok) {
      // Roll the switch back so the UI never shows an on state that is off.
      store.setSetting('captureSources', { ...sources, [id]: false });
    }
    pushState();
    return { ...res, sources: capture.list() };
  });

  ipcMain.handle('capture:pause', (_e, paused: boolean) => {
    if (!capture) return false;
    store.setSetting('capturePaused', capture.setPaused(paused));
    pushState();
    return capture.paused;
  });

  ipcMain.handle('capture:permission', async (_e, id: CaptureSourceId) => {
    const res = (await capture?.requestPermission(id)) ?? { granted: false, status: 'unavailable' };
    pushState();
    return res;
  });

  ipcMain.handle('capture:add-folder', async () => {
    const picked = await dialog.showOpenDialog(win!, {
      title: 'Choose a folder to remember',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (picked.canceled || !picked.filePaths.length) return store.settings.memoryFolders;
    const folders = [...new Set([...store.settings.memoryFolders, ...picked.filePaths])];
    store.setSetting('memoryFolders', folders);
    capture?.refresh('files');
    pushState();
    return folders;
  });

  ipcMain.handle('capture:remove-folder', (_e, folder: string) => {
    const folders = store.settings.memoryFolders.filter((f) => f !== folder);
    store.setSetting('memoryFolders', folders);
    capture?.refresh('files');
    pushState();
    return folders;
  });

  /* ---- mcp connector ---- */

  ipcMain.handle('mcp:set', async (_e, enabled: boolean) => {
    store.setSetting('mcpEnabled', Boolean(enabled));
    if (enabled && mcp) {
      const info = await mcp.start();
      store.setSetting('mcpPort', info.port ?? store.settings.mcpPort);
      store.setSetting('mcpToken', info.token ?? '');
    } else {
      mcp?.stop();
    }
    pushState();
    return mcp?.info() ?? null;
  });

  ipcMain.handle('mcp:regenerate', () => {
    const info = mcp?.regenerateToken();
    if (info) store.setSetting('mcpToken', info.token ?? '');
    pushState();
    return info ?? null;
  });

  /* ---- notch panel ---- */

  ipcMain.handle('notch:set', (_e, enabled: boolean) => {
    store.setSetting('notchEnabled', Boolean(enabled));
    if (enabled) notch?.start();
    else notch?.stop();
    pushState();
    return notch?.isOpen ?? false;
  });

  ipcMain.handle('app:show-window', () => showWindow());

  ipcMain.handle('memory:remember-files', async (_e, paths: string[]) => {
    if (!memory || !Array.isArray(paths)) return 0;
    const fs = await import('fs');
    let n = 0;
    for (const file of paths) {
      if (typeof file !== 'string' || !file) continue;
      try {
        const stat = fs.statSync(file);
        // Same ceiling the folder source uses, so a dropped video cannot
        // wedge the app while it tries to read it as text.
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
        const text = fs.readFileSync(file, 'utf8');
        if (text.includes(String.fromCharCode(0))) continue;
        const res = memory.capture({
          source: 'dropped',
          kind: 'file',
          text,
          title: path.basename(file),
          ts: stat.mtimeMs,
          meta: { path: file },
        });
        if (res.added) n++;
      } catch {
        // Unreadable or not text; skip it rather than failing the whole drop.
      }
    }
    pushState();
    return n;
  });

  ipcMain.handle('app:reveal-data', () => shell.openPath(dataPath().dir));
  ipcMain.handle('app:quit', () => {
    quitting = true;
    app.quit();
  });
}

/* ---------------- lifecycle ---------------- */

void app.whenReady().then(() => {
  store = new Store();
  scheduler = new Scheduler(store);

  scheduler.on('fire', (r) => {
    notifier.fire(r, {
      sound: store.settings.notificationSound,
      snoozeMinutes: store.settings.snoozeMinutes,
      onOpen: (id) => showWindow(id),
      onSnooze: (id, m) => {
        scheduler.snooze(id, m);
        pushState();
      },
    });
  });
  scheduler.on('changed', () => pushState());

  quick = new QuickCapture(() => rememberClipboard());

  tray = new AppTray({
    store,
    onShow: (id) => showWindow(id),
    onQuickCapture: () => rememberClipboard(),
    onQuit: () => {
      quitting = true;
      app.quit();
    },
    onSnooze: (id, m) => {
      scheduler.snooze(id, m);
      pushState();
    },
  });

  /* ---- memory, capture, connector ---- */

  memory = new Memory({ dir: dataPath().dir, settings: store.settings });
  capture = new CaptureManager({ memory, settings: () => store.settings });
  mcp = new McpBridge({
    memory,
    settings: () => store.settings,
    reminders: {
      list: () =>
        [...store.reminders].sort((a, b) => (a.snoozedUntil ?? a.at) - (b.snoozedUntil ?? b.at)),
      add: (input) => saveReminder(input),
    },
  });

  notch = new NotchPanel({ settings: () => store.settings, ...notchPaths() });

  memory.on('status', () => pushState());
  memory.on('indexed', () => pushState());
  capture.on('changed', () => pushState());
  capture.on('captured', (e) => {
    notch?.pulse(e.title || `${e.chunks} remembered`);
    pushState();
  });

  // The model load and the first index pass must not hold up the window or
  // the reminder scheduler, so this is deliberately not awaited.
  void memory
    .start()
    .then(async () => {
      capture?.setPaused(store.settings.capturePaused);
      capture?.sync();
      if (store.settings.retentionDays || store.settings.maxChunks) {
        memory?.prune({
          days: store.settings.retentionDays || null,
          maxChunks: store.settings.maxChunks || null,
        });
      }
      if (store.settings.notchEnabled) notch?.start();
      syncQuickCapture();
      if (store.settings.mcpEnabled && mcp) {
        const info = await mcp.start();
        store.setSetting('mcpPort', info.port ?? store.settings.mcpPort);
        store.setSetting('mcpToken', info.token ?? '');
      }
    })
    .catch(() => {
      /* surfaced through the status event */
    })
    .finally(() => pushState());

  registerIpc();

  // Keep the stored preference honest about what the OS actually has.
  store.settings.launchAtLogin = autostart.isEnabled();

  const startHidden = autostart.launchedAtLogin() && store.settings.startHidden;
  createWindow({ show: !startHidden });
  if (startHidden && process.platform === 'darwin' && !store.settings.showInDock) {
    app.dock?.hide();
  }

  scheduler.start();

  // Timers fire late or not at all across suspend; re-check on the way back.
  powerMonitor.on('resume', () => scheduler.tick());
  powerMonitor.on('unlock-screen', () => scheduler.tick());
});

app.on('second-instance', () => showWindow());

// The whole point is to keep running with no windows open. Electron quits by
// itself only when nothing is subscribed here, so an empty handler is what
// keeps the app alive -- there is no event to cancel.
app.on('window-all-closed', () => {
  /* stay in the tray */
});

app.on('activate', () => showWindow());

app.on('before-quit', () => {
  quitting = true;
  scheduler?.stop();
  capture?.stopAll();
  mcp?.stop();
  memory?.stop();
  notch?.stop();
  quick?.stop();
});

app.on('will-quit', () => {
  tray?.destroy();
  // Electron does this on exit anyway; being explicit means a hotkey cannot
  // outlive the app if something else keeps the process alive.
  globalShortcut.unregisterAll();
});
