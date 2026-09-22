import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import type { TimerKind, TimersState } from '../../types';

/**
 * Pomodoro, countdown, stopwatch and a hydration nudge, all driven by one
 * one-second tick so the four of them never drift against each other or
 * against the wall clock.
 *
 * The tick runs whether or not the notch is open: a pomodoro that only
 * counted down while a hover panel happened to be visible would not be a
 * timer. Only the hydration schedule is persisted -- the other three reset
 * on restart, which is what you'd want from a stopwatch or a countdown
 * anyway.
 */

const WORK_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;

interface Persisted {
  hydrationEnabled: boolean;
  hydrationMinutes: number;
  hydrationNextAt: number | null;
}

const DEFAULT_PERSISTED: Persisted = {
  hydrationEnabled: false,
  hydrationMinutes: 60,
  hydrationNextAt: null,
};

interface TimersEvents {
  tick: [TimersState];
  notify: [{ title: string; body: string }];
}

export class TimersEngine extends EventEmitter<TimersEvents> {
  private readonly file: string;
  private timer: NodeJS.Timeout | null = null;

  private active: TimerKind | null = null;
  private running = false;
  private seconds = 0;
  private pomodoroPhase: 'work' | 'break' = 'work';
  private pomodoroCount = 0;
  private countdownTotal = 300;
  private persisted: Persisted;

  constructor(dir: string) {
    super();
    this.file = path.join(dir, 'tools-timers.json');
    this.persisted = this.read();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  private read(): Persisted {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Persisted>;
      return { ...DEFAULT_PERSISTED, ...raw };
    } catch {
      return { ...DEFAULT_PERSISTED };
    }
  }

  private write(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.persisted));
    } catch {
      /* a missed save just means the next nudge is timed from scratch */
    }
  }

  private tick(): void {
    let changed = false;

    if (this.running && this.active) {
      if (this.active === 'stopwatch') {
        this.seconds += 1;
        changed = true;
      } else if (this.seconds > 0) {
        this.seconds -= 1;
        changed = true;
        if (this.seconds === 0) this.onPhaseEnd();
      }
    }

    if (this.persisted.hydrationEnabled && this.persisted.hydrationNextAt !== null) {
      if (Date.now() >= this.persisted.hydrationNextAt) {
        this.emit('notify', {
          title: 'Drink some water',
          body: `It's been ${this.persisted.hydrationMinutes} minutes.`,
        });
        this.persisted.hydrationNextAt = Date.now() + this.persisted.hydrationMinutes * 60_000;
        this.write();
      }
      changed = true; // the countdown to the next nudge is always moving
    }

    if (changed) this.emit('tick', this.state());
  }

  private onPhaseEnd(): void {
    if (this.active === 'countdown') {
      this.running = false;
      this.emit('notify', { title: 'Countdown done', body: 'Time is up.' });
      return;
    }
    if (this.active === 'pomodoro') {
      if (this.pomodoroPhase === 'work') {
        this.pomodoroCount += 1;
        this.pomodoroPhase = 'break';
        this.seconds = BREAK_SECONDS;
        this.emit('notify', { title: 'Break time', body: 'Five minutes off the screen.' });
      } else {
        this.pomodoroPhase = 'work';
        this.seconds = WORK_SECONDS;
        this.emit('notify', { title: 'Back to work', body: 'The break is over.' });
      }
    }
  }

  state(): TimersState {
    return {
      active: this.active,
      running: this.running,
      seconds: this.seconds,
      pomodoroPhase: this.pomodoroPhase,
      pomodoroCount: this.pomodoroCount,
      countdownTotal: this.countdownTotal,
      hydrationEnabled: this.persisted.hydrationEnabled,
      hydrationMinutes: this.persisted.hydrationMinutes,
      hydrationNextAt: this.persisted.hydrationNextAt,
    };
  }

  start(kind: TimerKind): TimersState {
    if (this.active !== kind) {
      this.active = kind;
      if (kind === 'pomodoro' && this.seconds <= 0) {
        this.pomodoroPhase = 'work';
        this.seconds = WORK_SECONDS;
      } else if (kind === 'countdown' && this.seconds <= 0) {
        this.seconds = this.countdownTotal;
      } else if (kind === 'stopwatch') {
        // picking up a running stopwatch resumes it; switching in fresh starts at 0
      }
    }
    if (this.active === 'countdown' && this.seconds <= 0) this.seconds = this.countdownTotal;
    this.running = true;
    this.emit('tick', this.state());
    return this.state();
  }

  pause(): TimersState {
    this.running = false;
    this.emit('tick', this.state());
    return this.state();
  }

  reset(kind: TimerKind): TimersState {
    if (kind === 'pomodoro') {
      this.pomodoroPhase = 'work';
      this.seconds = this.active === 'pomodoro' ? WORK_SECONDS : this.seconds;
      this.pomodoroCount = 0;
      if (this.active === 'pomodoro') this.running = false;
    } else if (kind === 'countdown') {
      if (this.active === 'countdown') {
        this.seconds = this.countdownTotal;
        this.running = false;
      }
    } else if (kind === 'stopwatch') {
      if (this.active === 'stopwatch') {
        this.seconds = 0;
        this.running = false;
      }
    }
    this.emit('tick', this.state());
    return this.state();
  }

  setCountdown(totalSeconds: number): TimersState {
    const secs = Math.max(1, Math.round(Number(totalSeconds) || 0));
    this.countdownTotal = secs;
    if (this.active !== 'countdown' || !this.running) {
      if (this.active === 'countdown' || this.active === null) this.seconds = secs;
    }
    this.emit('tick', this.state());
    return this.state();
  }

  setHydration(enabled: boolean, minutes: number): TimersState {
    const mins = Math.max(5, Math.round(Number(minutes) || DEFAULT_PERSISTED.hydrationMinutes));
    this.persisted.hydrationEnabled = Boolean(enabled);
    this.persisted.hydrationMinutes = mins;
    this.persisted.hydrationNextAt = this.persisted.hydrationEnabled
      ? Date.now() + mins * 60_000
      : null;
    this.write();
    this.emit('tick', this.state());
    return this.state();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
