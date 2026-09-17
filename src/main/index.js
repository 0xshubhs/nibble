'use strict';
const path = require('path');
const { app, BrowserWindow, ipcMain, powerMonitor, shell, nativeTheme } = require('electron');

const { initDataPath, dataPath } = require('./paths');
const { Store } = require('./store');
const { Scheduler, nextAfter, REPEATS } = require('./scheduler');
const { AppTray } = require('./tray');
const autostart = require('./autostart');
const notifier = require('./notifier');
const { Memory } = require('./memory');
const { CaptureManager } = require('./capture');
const { McpBridge } = require('./mcp/server');

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

let store;
let scheduler;
let tray;
let memory;
let capture;
let mcp;
let win = null;
let quitting = false;

/* ---------------- window ---------------- */

function createWindow({ show }) {
  win = new BrowserWindow({
    width: 880,
    height: 660,
    minWidth: 560,
    minHeight: 460,
    show: false,
    title: app.getName(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14141b' : '#f6f6fa',
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

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    if (show) win.show();
    maybeScreenshot();
  });

  // The close button hides the window; only an explicit Quit really exits.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (process.platform === 'darwin' && !store.settings.showInDock) app.dock?.hide();
  });

  // Anything that is not our own page opens in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

/**
 * Development helper: `--screenshot=<file> [--tab=memory] [--wait=ms]` renders
 * the window off-screen, captures it and exits. Capturing from inside the app
 * beats a screen grab, which picks up whatever else is in front.
 */
function maybeScreenshot() {
  if (app.isPackaged) return;
  const arg = process.argv.find((a) => a.startsWith('--screenshot='));
  if (!arg) return;

  const file = arg.slice('--screenshot='.length);
  const tab = (process.argv.find((a) => a.startsWith('--tab=')) || '--tab=reminders').slice(6);
  const wait = Number((process.argv.find((a) => a.startsWith('--wait=')) || '--wait=1200').slice(7));

  win.webContents.on('console-message', (_e, level, message) => {
    console.log('RENDERER[' + level + '] ' + message);
  });

  setTimeout(async () => {
    try {
      const query = (process.argv.find((a) => a.startsWith('--query=')) || '--query=').slice(8);
      const scroll = Number((process.argv.find((a) => a.startsWith('--scroll=')) || '--scroll=0').slice(9));
      const info = await win.webContents.executeJavaScript(
        `(() => {
           const b = document.querySelector('[data-tab="${tab}"]');
           if (b) b.click();
           const q = ${JSON.stringify(query)};
           if (q) {
             const box = document.getElementById('m-q');
             if (box) { box.value = q; box.dispatchEvent(new Event('input', { bubbles: true })); }
           }
           window.scrollTo(0, ${scroll});
           return { found: !!b, active: document.querySelector('.panel.is-active')?.id };
         })()`
      );
      console.log('SHOT_CLICK ' + JSON.stringify(info));
      // An occluded window composites lazily, so bring it up and give it a
      // beat before capturing or the frame is the previous tab.
      win.showInactive();
      win.moveTop();
      await new Promise((r) => setTimeout(r, 1200));
      const img = await win.webContents.capturePage();
      require('fs').writeFileSync(file, img.toPNG());
      console.log('SHOT ' + file);
    } catch (err) {
      console.log('SHOT_FAIL ' + err.message);
    }
    quitting = true;
    app.exit(0);
  }, wait);
}

function showWindow(focusId) {
  if (!win || win.isDestroyed()) createWindow({ show: true });
  if (process.platform === 'darwin') app.dock?.show();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (focusId) {
    win.webContents.send('focus-reminder', focusId);
  }
}

/* ---------------- sync helpers ---------------- */

function pushState() {
  tray?.render();
  // The webContents can be torn down a beat before the window is, so checking
  // only the window logs "Render frame was disposed" noise on every quit.
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send('state', snapshot());
  }
}

/**
 * Absolute path to the stdio relay, which is what a client actually spawns.
 * In a packaged app it lives beside the archive rather than inside it, because
 * a plain `node` cannot read files out of an asar.
 */
function relayPath() {
  const p = path.join(__dirname, '..', 'mcp', 'stdio.js');
  return app.isPackaged ? p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`) : p;
}

function snapshot() {
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
    },
    memory: memory
      ? {
          stats: memory.stats(),
          sources: capture.list(),
          paused: capture.paused,
          mcp: mcp.info(),
        }
      : null,
  };
}

/* ---------------- reminders ---------------- */

/**
 * The single place a reminder is created or edited. The window and the MCP
 * tool both come through here, so an assistant-scheduled reminder gets exactly
 * the same validation and roll-forward as one typed into the UI.
 */
function saveReminder(input) {
  const now = Date.now();
  const existing = input.id ? store.find(input.id) : null;

  const repeat = REPEATS.has(input.repeat) ? input.repeat : 'none';
  let at = Number(input.at);
  if (!Number.isFinite(at)) throw new Error('invalid time');

  // A time already in the past only makes sense for a repeating reminder,
  // where it anchors the series -- roll it forward to the next real slot.
  if (at <= now) {
    const next = nextAfter(at, now, repeat, input.intervalMinutes);
    if (next !== null) at = next;
  }

  const reminder = {
    id: existing?.id || `r_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title: String(input.title || '').trim() || 'Reminder',
    body: String(input.body || '').trim(),
    at,
    repeat,
    intervalMinutes: Math.max(1, Number(input.intervalMinutes) || 60),
    enabled: input.enabled !== false,
    snoozedUntil: null,
    createdAt: existing?.createdAt || now,
    lastFiredAt: existing?.lastFiredAt || null,
  };

  store.upsert(reminder);
  scheduler.tick();
  pushState();
  return reminder;
}

/* ---------------- ipc ---------------- */

function registerIpc() {
  ipcMain.handle('state:get', () => snapshot());

  ipcMain.handle('reminder:save', (_e, input) => saveReminder(input));

  ipcMain.handle('reminder:delete', (_e, id) => {
    store.remove(id);
    scheduler.arm();
    pushState();
    return true;
  });

  ipcMain.handle('reminder:toggle', (_e, id, enabled) => {
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

  ipcMain.handle('reminder:snooze', (_e, id, minutes) => {
    const r = scheduler.snooze(id, Number(minutes) || store.settings.snoozeMinutes);
    pushState();
    return r;
  });

  ipcMain.handle('reminder:test', (_e, id) => {
    const r = store.find(id);
    notifier.fire(r || { title: app.getName(), body: 'Notifications are working.' }, {
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

  ipcMain.handle('settings:set', (_e, key, value) => {
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
    }
    pushState();
    return snapshot().settings;
  });

  /* ---- memory ---- */

  ipcMain.handle('memory:search', (_e, query, opts) => memory.search(query, opts || {}));
  ipcMain.handle('memory:recent', (_e, limit, source) => memory.recent(limit || 20, source || null));
  ipcMain.handle('memory:stats', () => memory.stats());

  ipcMain.handle('memory:capture', (_e, item) => {
    const res = memory.capture({ source: 'manual', kind: 'note', ...item });
    pushState();
    return res;
  });

  ipcMain.handle('memory:forget', (_e, id) => {
    const ok = memory.forget(id);
    pushState();
    return ok;
  });

  ipcMain.handle('memory:forget-source', (_e, source) => {
    const n = memory.forgetSource(source);
    pushState();
    return n;
  });

  ipcMain.handle('memory:compact', () => {
    const n = memory.compact();
    pushState();
    return n;
  });

  ipcMain.handle('memory:set-backend', async (_e, cfg) => {
    store.setSetting('embedBackend', cfg.backend);
    if (cfg.provider) store.setSetting('embedProvider', cfg.provider);
    if (cfg.apiKey !== undefined) store.setSetting('embedApiKey', cfg.apiKey);
    const stats = await memory.setBackend(cfg);
    pushState();
    return stats;
  });

  /* ---- capture ---- */

  ipcMain.handle('capture:set', (_e, id, enabled) => {
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

  ipcMain.handle('capture:pause', (_e, paused) => {
    store.setSetting('capturePaused', capture.setPaused(paused));
    pushState();
    return capture.paused;
  });

  ipcMain.handle('capture:permission', async (_e, id) => {
    const res = await capture.requestPermission(id);
    pushState();
    return res;
  });

  ipcMain.handle('capture:add-folder', async () => {
    const { dialog } = require('electron');
    const picked = await dialog.showOpenDialog(win, {
      title: 'Choose a folder to remember',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (picked.canceled || !picked.filePaths.length) return store.settings.memoryFolders;
    const folders = [...new Set([...store.settings.memoryFolders, ...picked.filePaths])];
    store.setSetting('memoryFolders', folders);
    capture.refresh('files');
    pushState();
    return folders;
  });

  ipcMain.handle('capture:remove-folder', (_e, folder) => {
    const folders = store.settings.memoryFolders.filter((f) => f !== folder);
    store.setSetting('memoryFolders', folders);
    capture.refresh('files');
    pushState();
    return folders;
  });

  /* ---- mcp connector ---- */

  ipcMain.handle('mcp:set', async (_e, enabled) => {
    store.setSetting('mcpEnabled', Boolean(enabled));
    if (enabled) {
      const info = await mcp.start();
      store.setSetting('mcpPort', info.port || store.settings.mcpPort);
      store.setSetting('mcpToken', info.token);
    } else {
      mcp.stop();
    }
    pushState();
    return mcp.info();
  });

  ipcMain.handle('mcp:regenerate', () => {
    const info = mcp.regenerateToken();
    store.setSetting('mcpToken', info.token);
    pushState();
    return info;
  });

  ipcMain.handle('app:reveal-data', () => shell.openPath(dataPath().dir));
  ipcMain.handle('app:quit', () => {
    quitting = true;
    app.quit();
  });
}

/* ---------------- lifecycle ---------------- */

app.whenReady().then(() => {
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

  tray = new AppTray({
    store,
    onShow: (id) => showWindow(id === 'new' ? 'new' : id),
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
        [...store.reminders].sort((a, b) => (a.snoozedUntil || a.at) - (b.snoozedUntil || b.at)),
      add: (input) => saveReminder(input),
    },
  });

  memory.on('status', () => pushState());
  memory.on('indexed', () => pushState());
  capture.on('changed', () => pushState());
  capture.on('captured', () => pushState());

  // The model load and the first index pass must not hold up the window or
  // the reminder scheduler, so this is deliberately not awaited.
  memory
    .start()
    .then(() => {
      capture.setPaused(store.settings.capturePaused);
      capture.sync();
      if (store.settings.retentionDays || store.settings.maxChunks) {
        memory.prune({ days: store.settings.retentionDays || null, maxChunks: store.settings.maxChunks || null });
      }
      if (store.settings.mcpEnabled) {
        return mcp.start().then((info) => {
          store.setSetting('mcpPort', info.port || store.settings.mcpPort);
          store.setSetting('mcpToken', info.token);
        });
      }
      return null;
    })
    .catch(() => { /* surfaced through the status event */ })
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

// The whole point is to keep running with no windows open.
app.on('window-all-closed', (e) => e?.preventDefault?.());

app.on('activate', () => showWindow());

app.on('before-quit', () => {
  quitting = true;
  scheduler?.stop();
  capture?.stopAll();
  mcp?.stop();
  memory?.stop();
});

app.on('will-quit', () => tray?.destroy());
