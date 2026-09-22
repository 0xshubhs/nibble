import { execFile } from 'child_process';
import type { CalendarAgenda, CalendarEvent, CalendarReminderItem } from '../../types';

/**
 * A seven-day agenda plus reminders, read from Calendar.app and Reminders.app.
 *
 * There is no public framework for either from a sandboxed Electron renderer,
 * so this goes through JavaScript for Automation (`osascript -l JavaScript`)
 * instead of AppleScript proper: JXA hands back real `Date` objects, so a
 * date crosses the boundary as milliseconds rather than through AppleScript's
 * locale-dependent date-to-string coercion, which has no reliable inverse.
 *
 * The first call triggers the same macOS Automation permission prompt the
 * Now Playing source already asks for, for a different pair of apps. Every
 * call carries a hard timeout, so a prompt nobody answers fails the request
 * instead of hanging the main process.
 */

const TIMEOUT_MS = 10_000;

function jxa(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-l', 'JavaScript', '-e', script],
      { timeout: TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.trim() || err.message));
        else resolve(stdout);
      }
    );
  });
}

function agendaScript(days: number): string {
  // Kept as one expression-bodied `run` so osascript has exactly one thing
  // to evaluate; a syntax error anywhere in here fails the whole call rather
  // than partially running.
  return `
    function run() {
      const startD = new Date();
      const endD = new Date(startD.getTime() + ${days} * 24 * 60 * 60 * 1000);
      const events = [];
      try {
        const Cal = Application('Calendar');
        for (const cal of Cal.calendars()) {
          let evts = [];
          try {
            evts = cal.events.whose({
              _and: [{ startDate: { '>': startD } }, { startDate: { '<': endD } }],
            })();
          } catch (e) { continue; }
          for (const e of evts) {
            try {
              events.push({
                id: e.uid(),
                title: e.summary(),
                start: e.startDate().getTime(),
                end: e.endDate().getTime(),
                calendar: cal.name(),
                allDay: e.alldayEvent(),
              });
            } catch (e) { /* one malformed event should not sink the batch */ }
          }
        }
      } catch (e) { /* Calendar not scriptable or permission denied */ }

      const reminders = [];
      try {
        const Rem = Application('Reminders');
        for (const list of Rem.lists()) {
          for (const r of list.reminders.whose({ completed: false })()) {
            try {
              const due = r.dueDate();
              reminders.push({
                id: r.id(),
                title: r.name(),
                due: due ? due.getTime() : null,
                list: list.name(),
              });
            } catch (e) { /* skip */ }
          }
        }
      } catch (e) { /* Reminders not scriptable or permission denied */ }

      return JSON.stringify({ events: events, reminders: reminders });
    }
  `;
}

function completeScript(id: string): string {
  const escaped = JSON.stringify(id);
  return `
    function run() {
      const Rem = Application('Reminders');
      for (const list of Rem.lists()) {
        for (const r of list.reminders()) {
          if (r.id() === ${escaped}) {
            r.completed = true;
            return 'true';
          }
        }
      }
      return 'false';
    }
  `;
}

export function supported(): boolean {
  return process.platform === 'darwin';
}

export async function getAgenda(days = 7): Promise<CalendarAgenda> {
  if (!supported()) return { ok: false, error: 'macOS only', events: [], reminders: [] };
  try {
    const out = await jxa(agendaScript(Math.max(1, Math.min(31, days))));
    const parsed = JSON.parse(out) as { events: CalendarEvent[]; reminders: CalendarReminderItem[] };
    return {
      ok: true,
      events: (parsed.events ?? []).sort((a, b) => a.start - b.start),
      reminders: (parsed.reminders ?? []).sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity)),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      events: [],
      reminders: [],
    };
  }
}

export async function completeReminder(id: string): Promise<boolean> {
  if (!supported()) return false;
  try {
    const out = await jxa(completeScript(id));
    return out.trim() === 'true';
  } catch {
    return false;
  }
}
