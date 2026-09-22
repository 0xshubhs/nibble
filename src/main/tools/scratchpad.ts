import fs from 'fs';
import path from 'path';
import type { ScratchpadState } from '../../types';

/**
 * One text box, kept as a single flat file rather than a list -- there is
 * exactly one scratchpad, and "pinned" is a property of that one thing, not
 * a per-item flag the way it is for a clipboard entry.
 */

const DEFAULT_STATE: ScratchpadState = { text: '', pinned: false, updatedAt: 0 };

export class Scratchpad {
  private readonly file: string;
  private state: ScratchpadState;

  constructor(dir: string) {
    this.file = path.join(dir, 'tools-scratchpad.json');
    this.state = this.read();
  }

  private read(): ScratchpadState {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<ScratchpadState>;
      return { ...DEFAULT_STATE, ...raw };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  private write(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.state));
    } catch {
      /* the in-memory copy is still correct even if the save failed */
    }
  }

  get(): ScratchpadState {
    return this.state;
  }

  set(text: string): ScratchpadState {
    this.state = { ...this.state, text: String(text ?? ''), updatedAt: Date.now() };
    this.write();
    return this.state;
  }

  setPinned(pinned: boolean): ScratchpadState {
    this.state = { ...this.state, pinned: Boolean(pinned) };
    this.write();
    return this.state;
  }
}
