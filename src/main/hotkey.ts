import { globalShortcut } from 'electron';
import type { HotkeyState } from '../types';

/**
 * One global keyboard shortcut, registered through Electron and reported
 * honestly: a combination another app already owns is refused by the OS
 * rather than thrown, and a malformed accelerator throws outright. Both end
 * up in `error`, so a settings switch can show the real state instead of
 * claiming to be on.
 *
 * Shared by quick capture and the recall overlay -- two keys with the exact
 * same registration dance and the same idempotent `apply()`.
 */
export class GlobalHotkey {
  private accelerator: string;
  private enabled = false;
  private registered = false;
  private error: string | null = null;

  constructor(
    private readonly defaultAccelerator: string,
    private readonly onTrigger: () => void
  ) {
    this.accelerator = defaultAccelerator;
  }

  /** Idempotent: re-registers only when the setting or the key changed. */
  apply(enabled: boolean, accelerator: string): HotkeyState {
    const wanted = (accelerator || this.defaultAccelerator).trim();
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

  state(): HotkeyState {
    return {
      enabled: this.enabled,
      accelerator: this.accelerator,
      registered: this.registered,
      error: this.error,
    };
  }
}
