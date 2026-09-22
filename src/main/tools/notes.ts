import fs from 'fs';
import path from 'path';
import type { NoteItem } from '../../types';

/**
 * Longer thoughts than the scratchpad wants, kept as a flat list next to it.
 * No folders, no tags -- the same one-file-per-tool storage every other tool
 * here uses, sorted by whichever note was touched most recently.
 */

export class NotesStore {
  private readonly file: string;
  private notes: NoteItem[] = [];

  constructor(dir: string) {
    this.file = path.join(dir, 'tools-notes.json');
    this.notes = this.read();
  }

  private read(): NoteItem[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private write(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.notes));
    } catch {
      /* the in-memory list is still correct even if the save failed */
    }
  }

  list(): NoteItem[] {
    return [...this.notes].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  create(): NoteItem[] {
    const now = Date.now();
    this.notes.push({
      id: `n_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      title: '',
      body: '',
      createdAt: now,
      updatedAt: now,
    });
    this.write();
    return this.list();
  }

  update(id: string, patch: { title?: string; body?: string }): NoteItem[] {
    const note = this.notes.find((n) => n.id === id);
    if (note) {
      if (patch.title !== undefined) note.title = patch.title;
      if (patch.body !== undefined) note.body = patch.body;
      note.updatedAt = Date.now();
      this.write();
    }
    return this.list();
  }

  remove(id: string): NoteItem[] {
    this.notes = this.notes.filter((n) => n.id !== id);
    this.write();
    return this.list();
  }
}
