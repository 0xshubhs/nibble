/**
 * The window UI. No framework, no imports -- this file is loaded by a plain
 * <script src>, so it must stay a script rather than a module. Its types come
 * from the ambient declarations in env.d.ts.
 */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const REPEAT_LABEL: Record<string, string> = {
  none: 'Once',
  hourly: 'Every hour',
  daily: 'Every day',
  weekdays: 'Weekdays',
  weekly: 'Every week',
  custom: 'Custom',
};

let state: AppSnapshot = {
  reminders: [],
  settings: {} as AppSnapshot['settings'],
  meta: {} as AppSnapshot['meta'],
  memory: null,
};
let editingId: string | null = null;

/* ---------------- formatting ---------------- */

function formatWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((d.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  const date = new Date(ts).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: days > 300 || days < -300 ? 'numeric' : undefined,
  });
  return `${date} ${time}`;
}

function countdown(ts: number): string {
  const ms = ts - Date.now();
  if (ms <= 0) return 'due now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `in ${hrs} h`;
  return `in ${Math.round(hrs / 24)} days`;
}

/* ---------------- reminder list ---------------- */

function renderItem(r: AppReminder): HTMLLIElement {
  const li = document.createElement('li');
  li.className = `item${r.enabled ? '' : ' is-off'}`;
  li.dataset.id = r.id;

  const main = document.createElement('div');
  main.className = 'item-main';

  const title = document.createElement('div');
  title.className = 'item-title';
  title.textContent = r.title;
  main.append(title);

  const meta = document.createElement('div');
  meta.className = 'item-meta';

  const when = document.createElement('span');
  const at = r.snoozedUntil ?? r.at;
  when.textContent = r.enabled ? `${formatWhen(at)} · ${countdown(at)}` : formatWhen(at);
  meta.append(when);

  if (r.repeat !== 'none') {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent =
      r.repeat === 'custom' ? `Every ${r.intervalMinutes} min` : REPEAT_LABEL[r.repeat];
    meta.append(pill);
  }
  if (r.snoozedUntil) {
    const pill = document.createElement('span');
    pill.className = 'pill snoozed';
    pill.textContent = 'Snoozed';
    meta.append(pill);
  }
  if (r.body) {
    const note = document.createElement('span');
    note.textContent = r.body;
    meta.append(note);
  }
  main.append(meta);

  const actions = document.createElement('div');
  actions.className = 'item-actions';

  const toggle = document.createElement('label');
  toggle.className = 'switch';
  toggle.title = r.enabled ? 'Disable' : 'Enable';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = r.enabled;
  cb.addEventListener('change', () => void window.api.toggleReminder(r.id, cb.checked));
  toggle.append(cb, document.createElement('span'));

  const edit = document.createElement('button');
  edit.className = 'btn';
  edit.textContent = 'Edit';
  edit.addEventListener('click', () => openEditor(r));

  actions.append(toggle, edit);
  li.append(main, actions);
  return li;
}

function render(): void {
  const list = $('list');
  const items = [...state.reminders].sort(
    (a, b) => (a.snoozedUntil ?? a.at) - (b.snoozedUntil ?? b.at)
  );

  $('empty').hidden = items.length > 0;
  list.replaceChildren(...items.map(renderItem));
}

/* ---------------- reminder editor ---------------- */

// Local-time values for <input type="date"/"time">, which are timezone-naive.
const pad = (n: number): string => String(n).padStart(2, '0');
const toDateInput = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function syncIntervalVisibility(): void {
  $('f-interval-wrap').hidden = $<HTMLSelectElement>('f-repeat').value !== 'custom';
}

function openEditor(r: AppReminder | null): void {
  editingId = r?.id ?? null;
  const at = new Date(r?.at ?? Date.now() + 10 * 60000);

  $<HTMLInputElement>('f-title').value = r?.title ?? '';
  $<HTMLInputElement>('f-body').value = r?.body ?? '';
  $<HTMLInputElement>('f-date').value = toDateInput(at);
  $<HTMLInputElement>('f-time').value = toTimeInput(at);
  $<HTMLSelectElement>('f-repeat').value = r?.repeat ?? 'none';
  $<HTMLInputElement>('f-interval').value = String(r?.intervalMinutes ?? 60);
  $('delete-btn').hidden = !editingId;
  $('save-btn').textContent = editingId ? 'Save changes' : 'Add reminder';

  syncIntervalVisibility();
  $('editor').hidden = false;
  $('f-title').focus();
}

function closeEditor(): void {
  $('editor').hidden = true;
  editingId = null;
}

async function submitEditor(e: Event): Promise<void> {
  e.preventDefault();
  const [y, m, d] = $<HTMLInputElement>('f-date').value.split('-').map(Number);
  const [hh, mm] = $<HTMLInputElement>('f-time').value.split(':').map(Number);
  if (!y || Number.isNaN(hh)) return;

  await window.api.saveReminder({
    id: editingId,
    title: $<HTMLInputElement>('f-title').value,
    body: $<HTMLInputElement>('f-body').value,
    at: new Date(y, m - 1, d, hh, mm, 0, 0).getTime(),
    repeat: $<HTMLSelectElement>('f-repeat').value,
    intervalMinutes: Number($<HTMLInputElement>('f-interval').value),
    enabled: true,
  });
  closeEditor();
}

async function deleteCurrent(): Promise<void> {
  if (!editingId) return;
  await window.api.deleteReminder(editingId);
  closeEditor();
}

/* ---------------- settings ---------------- */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function renderSettings(): void {
  const s = state.settings;
  const m = state.meta;

  $<HTMLInputElement>('s-login').checked = Boolean(s.launchAtLogin);
  $<HTMLInputElement>('s-hidden').checked = Boolean(s.startHidden);
  $<HTMLInputElement>('s-dock').checked = Boolean(s.showInDock);
  $<HTMLInputElement>('s-sound').checked = Boolean(s.notificationSound);
  $<HTMLInputElement>('s-snooze').value = String(s.snoozeMinutes ?? 10);

  // The Dock toggle only means anything on macOS.
  $('dock-row').hidden = m.platform !== 'darwin';

  // The notch panel needs a built-in display, so it is hidden on a Mac mini
  // or a Windows box rather than offered and then refusing to start.
  const notch = m.notch;
  $('notch-row').hidden = !notch?.supported;
  if (notch?.supported) {
    $<HTMLInputElement>('s-notch').checked = notch.enabled;
    $('notch-note').textContent = notch.likelyNotched
      ? 'Hangs a panel off the notch for quick search and drop-to-remember.'
      : 'This Mac looks like it has no notch, so the panel hangs from the top of the screen instead.';
  }

  $('app-name').textContent = m.name || 'Nibble';
  $('app-sub').textContent = [
    m.portable ? 'portable mode' : 'installed',
    m.notifications ? 'notifications on' : 'notifications unavailable',
  ].join(' · ');

  const ok = m.notifications;
  $('notif-callout').classList.toggle('warn', !ok);
  $('notif-state').textContent = ok
    ? 'The system will ask for permission the first time a notification is sent. If nothing appears, allow this app in your OS notification settings.'
    : 'This system reports no notification support. Reminders still fire and show in the tray menu.';

  $('storage-state').innerHTML = `${
    m.portable
      ? 'Portable: everything is stored beside the executable.'
      : 'Installed: stored in the usual per-user app folder.'
  } <code>${escapeHtml(m.dataDir ?? '')}</code>`;

  $('version').textContent = `v${m.version ?? '0.0.0'}`;
}

/* ============================================================
   memory tab
   ============================================================ */

const mem = {
  q: '',
  results: [] as AppHit[],
  revealToken: false,
  searchSeq: 0,
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ago(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Wraps query terms in <mark> without ever injecting the text as HTML. */
function highlight(container: HTMLElement, text: string, query: string): void {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 2);
  if (!terms.length) {
    container.textContent = text;
    return;
  }
  const re = new RegExp(
    `(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'ig'
  );
  let last = 0;
  for (const m of text.matchAll(re)) {
    const index = m.index ?? 0;
    if (index > last) container.append(text.slice(last, index));
    const el = document.createElement('mark');
    el.textContent = m[0];
    container.append(el);
    last = index + m[0].length;
  }
  if (last < text.length) container.append(text.slice(last));
}

function renderHits(): void {
  const list = $('m-results');
  const empty = $('m-empty');

  if (!mem.results.length) {
    list.replaceChildren();
    empty.hidden = false;
    const s = state.memory?.stats;
    empty.textContent = mem.q
      ? `Nothing matches "${mem.q}".`
      : !s || s.chunks === 0
        ? 'Nothing captured yet. Turn on a source below, or add a note.'
        : 'Search what you have captured, or browse the most recent below.';
    return;
  }
  empty.hidden = true;

  list.replaceChildren(
    ...mem.results.map((h) => {
      const li = document.createElement('li');
      li.className = 'item hit';

      const head = document.createElement('div');
      head.className = 'hit-head';
      if (h.title) {
        const t = document.createElement('span');
        t.className = 'hit-title';
        t.textContent = h.title;
        head.append(t);
      }
      const src = document.createElement('span');
      src.className = 'pill src';
      src.textContent = h.source;
      head.append(src);

      if (h.matched) {
        const m = document.createElement('span');
        m.className = `pill match-${h.matched}`;
        m.textContent = h.matched === 'both' ? 'words + meaning' : h.matched;
        head.append(m);
      }

      const body = document.createElement('div');
      body.className = 'hit-text';
      highlight(body, h.text, mem.q);

      const foot = document.createElement('div');
      foot.className = 'hit-foot';
      const when = document.createElement('span');
      when.className = 'item-meta';
      when.textContent = ago(h.ts);
      const spacer = document.createElement('span');
      spacer.className = 'spacer';
      const forget = document.createElement('button');
      forget.className = 'btn btn-quiet';
      forget.textContent = 'Forget';
      forget.addEventListener('click', () => {
        void window.api.forget(h.id).then(runSearch);
      });
      foot.append(when, spacer, forget);

      li.append(head, body, foot);
      return li;
    })
  );
}

async function runSearch(): Promise<void> {
  const seq = ++mem.searchSeq;
  const q = mem.q.trim();

  const results = q ? await window.api.searchMemory(q, { k: 12 }) : await window.api.recentMemory(12);
  // A slower earlier query must not overwrite a newer one's results.
  if (seq !== mem.searchSeq) return;

  mem.results = results;
  renderHits();

  const s = state.memory?.stats;
  $('m-hint').textContent = !s
    ? ''
    : s.pending > 0
      ? `${s.pending} of ${s.chunks} still being indexed, so searching by keyword until then.`
      : q
        ? `${results.length} result${results.length === 1 ? '' : 's'} from ${s.chunks} chunks.`
        : `Most recent of ${s.chunks} chunks.`;
}

function renderSources(): void {
  const m = state.memory;
  if (!m) return;

  $<HTMLInputElement>('m-pause').checked = m.paused;
  $('pause-text').textContent = m.paused
    ? 'Capture is paused. Sources keep running but nothing is stored.'
    : 'Capture is running.';
  $('pause-row').classList.toggle('warn', m.paused);

  $('m-sources').replaceChildren(
    ...m.sources.map((src: AppSourceView) => {
      const li = document.createElement('li');
      if (!src.enabled) li.className = 'is-off';

      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = src.label;

      if (!src.supported) {
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = 'not on this platform';
        title.append(b);
      } else if (!src.implemented) {
        const b = document.createElement('span');
        b.className = 'badge warn';
        b.textContent = 'coming soon';
        title.append(b);
      } else if (src.state.running) {
        const b = document.createElement('span');
        b.className = 'badge ok';
        b.textContent = `${src.state.captured} captured`;
        title.append(b);
      }

      const desc = document.createElement('p');
      desc.textContent = src.description;
      info.append(title, desc);

      if (src.available?.note) {
        const note = document.createElement('p');
        note.textContent = src.available.note;
        info.append(note);
      }
      if (src.permission && src.available?.permission && src.available.permission !== 'granted') {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm';
        btn.style.marginTop = '7px';
        btn.textContent =
          src.permission === 'screen' ? 'Open Screen Recording settings' : 'Grant microphone access';
        btn.addEventListener('click', () => void window.api.requestCapturePermission(src.id));
        info.append(btn);
      }

      const toggle = document.createElement('label');
      toggle.className = 'switch';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = src.enabled;
      cb.disabled = !src.supported || !src.implemented;
      cb.addEventListener('change', () => {
        void window.api.setCapture(src.id, cb.checked).then((res) => {
          if (!res.ok) {
            cb.checked = false;
            $('m-hint').textContent = res.error ?? 'Could not start that source.';
          }
        });
      });
      toggle.append(cb, document.createElement('span'));

      li.append(info, toggle);
      return li;
    })
  );

  // The folder list only matters when the Folders source is on.
  const filesOn = m.sources.find((s: AppSourceView) => s.id === 'files')?.enabled;
  $('m-folder-block').hidden = !filesOn;
  if (!filesOn) return;

  const folders = state.settings.memoryFolders ?? [];
  if (!folders.length) {
    const li = document.createElement('li');
    const d = document.createElement('div');
    const p = document.createElement('p');
    p.textContent = 'No folders yet. Point it at your notes.';
    d.append(p);
    li.append(d);
    $('m-folders').replaceChildren(li);
    return;
  }

  $('m-folders').replaceChildren(
    ...folders.map((f: string) => {
      const li = document.createElement('li');
      const d = document.createElement('div');
      const p = document.createElement('div');
      p.className = 'folder-path';
      p.textContent = f;
      p.title = f;
      d.append(p);
      const rm = document.createElement('button');
      rm.className = 'btn btn-quiet';
      rm.textContent = 'Remove';
      rm.addEventListener('click', () => void window.api.removeFolder(f));
      li.append(d, rm);
      return li;
    })
  );
}

function renderConnector(): void {
  const info: AppMcpInfo | undefined = state.memory?.mcp;
  if (!info) return;

  $<HTMLInputElement>('m-mcp').checked = info.running;
  $('mcp-detail').hidden = !info.running;
  $('mcp-state').textContent = info.running
    ? `Running on 127.0.0.1:${info.port}. ${
        info.calls.length
          ? `${info.calls.length} recent call${info.calls.length === 1 ? '' : 's'}.`
          : 'No calls yet.'
      }`
    : info.error
      ? `Off. Last error: ${info.error}`
      : 'Off. Turn it on to let Claude, ChatGPT or any MCP client read this memory.';

  if (!info.running) return;

  $('mcp-cli').textContent = `claude mcp add nibble -- node ${state.meta.relay}`;
  $('mcp-url').textContent = info.url ?? '';
  $('mcp-token').textContent = mem.revealToken ? (info.token ?? '') : '•'.repeat(28);
  $('mcp-token').classList.toggle('masked', !mem.revealToken);
  $('mcp-reveal').textContent = mem.revealToken ? 'Hide' : 'Show';
}

function renderMemoryStats(): void {
  const m = state.memory;
  if (!m) {
    $('m-stats').textContent = 'Memory is still starting…';
    return;
  }
  const s = m.stats;
  $('m-stats').textContent =
    `${s.chunks} chunk${s.chunks === 1 ? '' : 's'}, ${s.embedded} indexed` +
    (s.pending ? `, ${s.pending} waiting` : '') +
    ` · ${fmtBytes(s.textBytes)} of text, ${fmtBytes(s.vectorBytes)} of vectors` +
    (s.tombstones ? ` · ${s.tombstones} forgotten, reclaim with Compact` : '');

  const e = s.embedder;
  const statusText =
    (
      {
        ready: 'ready',
        loading: 'starting',
        downloading: `downloading the model, ${e.progress}%`,
        'needs-key': 'needs an API key',
        error: `error: ${e.error}`,
        stopped: 'stopped',
        idle: 'idle',
      } as Record<string, string>
    )[e.status] ?? e.status;

  $('m-model').textContent =
    `Embedding with ${e.model} (${e.backend === 'local' ? 'on this device' : e.provider}, ${e.dim} dims): ${statusText}.`;
}

function renderMemory(): void {
  renderSources();
  renderConnector();
  renderMemoryStats();
}

function bindMemory(): void {
  let debounce: ReturnType<typeof setTimeout> | null = null;
  $('m-q').addEventListener('input', (e) => {
    mem.q = (e.target as HTMLInputElement).value;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void runSearch(), 180);
  });

  $('m-add').addEventListener('click', () => {
    const open = !$('m-editor').hidden;
    $('m-editor').hidden = open;
    if (!open) $('m-title').focus();
  });
  $('m-cancel').addEventListener('click', () => {
    $('m-editor').hidden = true;
  });
  $('m-editor').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $<HTMLTextAreaElement>('m-text').value.trim();
    if (!text) return;
    void window.api
      .captureNote({ text, title: $<HTMLInputElement>('m-title').value.trim() })
      .then((res) => {
        $<HTMLTextAreaElement>('m-text').value = '';
        $<HTMLInputElement>('m-title').value = '';
        $('m-editor').hidden = true;
        $('m-hint').textContent = res.added
          ? `Remembered in ${res.added} chunk${res.added === 1 ? '' : 's'}.`
          : `Not stored (${res.skipped}).`;
        return runSearch();
      });
  });

  $('m-pause').addEventListener('change', (e) =>
    void window.api.setPaused((e.target as HTMLInputElement).checked)
  );
  $('m-add-folder').addEventListener('click', () => void window.api.addFolder());
  $('m-mcp').addEventListener('change', (e) =>
    void window.api.setMcp((e.target as HTMLInputElement).checked)
  );
  $('m-compact').addEventListener('click', () => {
    void window.api.compactMemory().then(runSearch);
  });

  $('mcp-reveal').addEventListener('click', () => {
    mem.revealToken = !mem.revealToken;
    renderConnector();
  });
  $('mcp-regen').addEventListener('click', () => {
    mem.revealToken = true;
    void window.api.regenerateMcpToken();
  });

  document.querySelectorAll<HTMLButtonElement>('.copy').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.copy ?? '';
      // The token element is masked on screen; copy the real value.
      const value =
        target === 'mcp-token' ? (state.memory?.mcp.token ?? '') : ($(target).textContent ?? '');
      navigator.clipboard.writeText(value).then(
        () => {
          const was = btn.textContent;
          btn.textContent = 'Copied';
          setTimeout(() => {
            btn.textContent = was;
          }, 1200);
        },
        () => {
          btn.textContent = 'Press ⌘C';
        }
      );
    });
  });
}

/* ---------------- wiring ---------------- */

function bind(): void {
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      document.querySelectorAll('.panel').forEach((p) => {
        p.classList.toggle('is-active', p.id === `panel-${tab.dataset.tab}`);
      });
    });
  });

  $('new-btn').addEventListener('click', () => openEditor(null));
  $('cancel-btn').addEventListener('click', closeEditor);
  $('delete-btn').addEventListener('click', () => void deleteCurrent());
  $('editor').addEventListener('submit', (e) => void submitEditor(e));
  $('f-repeat').addEventListener('change', syncIntervalVisibility);

  $('s-login').addEventListener('change', (e) =>
    void window.api.setSetting('launchAtLogin', (e.target as HTMLInputElement).checked)
  );
  $('s-hidden').addEventListener('change', (e) =>
    void window.api.setSetting('startHidden', (e.target as HTMLInputElement).checked)
  );
  $('s-dock').addEventListener('change', (e) =>
    void window.api.setSetting('showInDock', (e.target as HTMLInputElement).checked)
  );
  $('s-sound').addEventListener('change', (e) =>
    void window.api.setSetting('notificationSound', (e.target as HTMLInputElement).checked)
  );
  $('s-snooze').addEventListener('change', (e) =>
    void window.api.setSetting(
      'snoozeMinutes',
      Math.max(1, Number((e.target as HTMLInputElement).value) || 10)
    )
  );

  $('s-notch').addEventListener('change', (e) =>
    void window.api.setNotch((e.target as HTMLInputElement).checked)
  );

  $('test-btn').addEventListener('click', () => void window.api.testNotification(null));
  $('reveal-btn').addEventListener('click', () => void window.api.revealData());
  $('quit-btn').addEventListener('click', () => void window.api.quit());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('editor').hidden) closeEditor();
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      openEditor(null);
    }
  });

  bindMemory();

  window.api.onState((next) => {
    const hadMemory = Boolean(state.memory);
    state = next;
    render();
    renderSettings();
    renderMemory();
    // Refresh the result list once memory finishes starting, so the tab is
    // not stuck on its empty state after a slow model load.
    if (!hadMemory && state.memory) void runSearch();
  });

  window.api.onFocusReminder((id) => {
    if (id === 'new') {
      openEditor(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(`.item[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('is-flash');
    setTimeout(() => el.classList.remove('is-flash'), 1600);
  });

  // Keeps the "in 12 min" labels honest without a full re-render storm.
  setInterval(render, 30_000);
}

void (async function init(): Promise<void> {
  bind();
  state = await window.api.getState();
  render();
  renderSettings();
  renderMemory();
  void runSearch();
})();
