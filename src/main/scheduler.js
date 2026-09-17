'use strict';
const { EventEmitter } = require('events');

// setTimeout overflows past 2^31-1 ms (~24.8 days) and fires immediately,
// so long waits are served in chunks.
const MAX_CHUNK = 2 ** 31 - 1;
// Cheap safety net: timers drift or fire late across sleep/wake, so sweep anyway.
const SWEEP_MS = 30_000;

const REPEATS = new Set(['none', 'hourly', 'daily', 'weekdays', 'weekly', 'custom']);

/**
 * Moves a timestamp forward by one repeat step, using local-calendar
 * arithmetic so a daily 9am reminder stays at 9am across a DST change
 * instead of drifting to 8am or 10am.
 */
function step(ts, repeat, intervalMinutes) {
  const d = new Date(ts);
  switch (repeat) {
    case 'hourly':
      d.setHours(d.getHours() + 1);
      break;
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'weekdays':
      do {
        d.setDate(d.getDate() + 1);
      } while (d.getDay() === 0 || d.getDay() === 6);
      break;
    case 'custom':
      d.setMinutes(d.getMinutes() + Math.max(1, Number(intervalMinutes) || 60));
      break;
    default:
      return null;
  }
  return d.getTime();
}

/** First occurrence strictly after `now`. Returns null for one-shot reminders. */
function nextAfter(ts, now, repeat, intervalMinutes) {
  if (!REPEATS.has(repeat) || repeat === 'none') return null;
  let next = ts;
  // Bounded so a corrupt interval can never spin forever.
  for (let i = 0; i < 100_000; i++) {
    next = step(next, repeat, intervalMinutes);
    if (next === null) return null;
    if (next > now) return next;
  }
  return null;
}

/** When a reminder actually wants to ring: its snooze, or its scheduled time. */
function dueAt(r) {
  if (!r.enabled) return null;
  // A snooze overrides the scheduled time until it is consumed by a tick.
  if (r.snoozedUntil) return r.snoozedUntil;
  return r.at;
}

class Scheduler extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.timer = null;
    this.sweep = null;
  }

  start() {
    this.sweep = setInterval(() => this.tick(), SWEEP_MS);
    this.tick();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    if (this.sweep) clearInterval(this.sweep);
    this.timer = null;
    this.sweep = null;
  }

  /** Fires everything that is due, rolls repeats forward, re-arms the timer. */
  tick() {
    const now = Date.now();
    let changed = false;

    for (const r of this.store.reminders) {
      const due = dueAt(r);
      if (due === null || due > now) continue;

      this.emit('fire', r);
      r.lastFiredAt = now;
      r.snoozedUntil = null;

      const next = nextAfter(r.at, now, r.repeat, r.intervalMinutes);
      if (next !== null) {
        // A repeating reminder that was missed while the app was closed rolls
        // forward to its next future slot -- one notification, not a backlog.
        r.at = next;
      } else {
        r.enabled = false;
      }
      changed = true;
    }

    if (changed) this.store.save();
    this.arm();
    if (changed) this.emit('changed');
  }

  /** Sleeps until the soonest due reminder, in <=24-day chunks. */
  arm() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    const now = Date.now();
    let soonest = Infinity;
    for (const r of this.store.reminders) {
      const due = dueAt(r);
      if (due !== null && due < soonest) soonest = due;
    }
    if (soonest === Infinity) return;

    const wait = Math.min(Math.max(soonest - now, 0), MAX_CHUNK);
    // Deliberately not unref'd: this timer is the only thing that has to
    // survive the app sitting idle in the tray with no windows open.
    this.timer = setTimeout(() => this.tick(), wait);
  }

  snooze(id, minutes) {
    const r = this.store.find(id);
    if (!r) return null;
    r.snoozedUntil = Date.now() + Math.max(1, minutes) * 60_000;
    r.enabled = true;
    this.store.save();
    this.arm();
    return r;
  }
}

module.exports = { Scheduler, nextAfter, step, dueAt, REPEATS };
