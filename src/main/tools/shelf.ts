import fs from 'fs';
import path from 'path';
import type { WebContents } from 'electron';
import { nativeImage } from 'electron';
import type { ShelfItem } from '../../types';

// Electron's startDrag rejects an empty icon, so the app's own icon stands
// in for a per-file thumbnail -- it's the drag cursor, not a preview.
const DRAG_ICON = path.join(__dirname, '..', '..', '..', 'assets', 'icon.png');

/**
 * A drop target that holds onto files. Dropped files are copied into app
 * data rather than referenced in place, so the shelf survives the original
 * being renamed, moved or deleted -- the whole point of a shelf is that it
 * doesn't care what happens anywhere else.
 */

export class Shelf {
  private readonly dir: string;
  private readonly metaFile: string;
  private items: ShelfItem[] = [];

  constructor(baseDir: string) {
    this.dir = path.join(baseDir, 'shelf');
    this.metaFile = path.join(this.dir, 'items.json');
    fs.mkdirSync(this.dir, { recursive: true });
    this.items = this.read();
    // Drop anything whose file went missing behind the metadata's back.
    this.items = this.items.filter((i) => fs.existsSync(i.path));
  }

  private read(): ShelfItem[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.metaFile, 'utf8'));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private write(): void {
    try {
      fs.writeFileSync(this.metaFile, JSON.stringify(this.items));
    } catch {
      /* the files themselves are still on disk even if the index write fails */
    }
  }

  /** A name that doesn't collide with what's already on the shelf. */
  private freeName(name: string): string {
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    let candidate = name;
    let n = 1;
    while (fs.existsSync(path.join(this.dir, candidate))) {
      candidate = `${base} (${n})${ext}`;
      n += 1;
    }
    return candidate;
  }

  list(): ShelfItem[] {
    return [...this.items].sort((a, b) => b.addedAt - a.addedAt);
  }

  add(sourcePaths: string[]): ShelfItem[] {
    for (const src of sourcePaths) {
      try {
        const stat = fs.statSync(src);
        if (!stat.isFile()) continue;
        const name = this.freeName(path.basename(src));
        const dest = path.join(this.dir, name);
        fs.copyFileSync(src, dest);
        this.items.push({
          id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          name,
          path: dest,
          size: stat.size,
          addedAt: Date.now(),
        });
      } catch {
        // unreadable or vanished mid-drag; skip it rather than fail the batch
      }
    }
    this.write();
    return this.list();
  }

  remove(id: string): ShelfItem[] {
    const item = this.items.find((i) => i.id === id);
    if (item) {
      try {
        fs.unlinkSync(item.path);
      } catch {
        /* already gone */
      }
    }
    this.items = this.items.filter((i) => i.id !== id);
    this.write();
    return this.list();
  }

  /** Starts an OS-level file drag out of the panel, into Finder or any app. */
  startDrag(id: string, sender: WebContents): void {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    sender.startDrag({
      file: item.path,
      icon: nativeImage.createFromPath(DRAG_ICON),
    });
  }
}
