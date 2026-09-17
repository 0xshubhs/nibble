import { globalShortcut } from 'electron';
import type { QuickCaptureState } from '../types';

/**
 * One global hotkey that remembers whatever is on the clipboard, from
 * wherever you happen to be.
 *
 * The point is the gap it closes: the clipboard source only sees what you
 * copy while it is running, and turning it on means everything you copy is
 * stored. This is the opposite trade -- nothing is watched, and a deliberate
 * key press is what saves one thing.
 *
 * Registration is the interesting part. A combination another app already
 * owns is refused by the OS, `register` returns false rather than throwing,
 * and a malformed accelerator throws outright. Both end up in `error`, so the
 * window can show the real state instead of a switch that claims to be on.
 */

export const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+M';

export class QuickCapture {
  private accelerator = DEFAULT_SHORTCUT;
  private enabled = false;
  private registered = false;
  private error: string | null = null;

  constructor(private readonly onTrigger: () => void) {}

  /** Idempotent: re-registers only when the setting or the key changed. */
  apply(enabled: boolean, accelerator: string): QuickCaptureState {
    const wanted = (accelerator || DEFAULT_SHORTCUT).trim();
    if (enabled === this.enabled && wanted === this.accelerator && this.registered === enabled) {
      return this.state();
    }

    this.unregister();
    this.enabled = enabled;
    this.accelerator = wanted;
    this.error = null;

    if (!enabled) return this.state();

    try {
      this.registered = globalShortcut.register(wanted, () => this.onTrigger());
      if (!this.registered) this.error = `${wanted} is already taken by another app`;
    } catch (err) {
      this.registered = false;
      this.error = err instanceof Error ? err.message : String(err);
    }
    return this.state();
  }

  private unregister(): void {
    if (!this.registered) return;
    try {
      globalShortcut.unregister(this.accelerator);
    } catch {
      /* it was never really ours */
    }
    this.registered = false;
  }

  stop(): void {
    this.unregister();
    this.enabled = false;
  }

  state(): QuickCaptureState {
    return {
      enabled: this.enabled,
      accelerator: this.accelerator,
      registered: this.registered,
      error: this.error,
    };
  }
}
