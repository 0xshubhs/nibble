import { GlobalHotkey } from './hotkey';
import type { QuickCaptureState } from '../types';

/**
 * One global hotkey that remembers whatever is on the clipboard, from
 * wherever you happen to be.
 *
 * The point is the gap it closes: the clipboard source only sees what you
 * copy while it is running, and turning it on means everything you copy is
 * stored. This is the opposite trade -- nothing is watched, and a deliberate
 * key press is what saves one thing.
 */

export const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+M';

export class QuickCapture {
  private readonly hotkey: GlobalHotkey;

  constructor(onTrigger: () => void) {
    this.hotkey = new GlobalHotkey(DEFAULT_SHORTCUT, onTrigger);
  }

  apply(enabled: boolean, accelerator: string): QuickCaptureState {
    return this.hotkey.apply(enabled, accelerator);
  }

  stop(): void {
    this.hotkey.stop();
  }

  state(): QuickCaptureState {
    return this.hotkey.state();
  }
}
