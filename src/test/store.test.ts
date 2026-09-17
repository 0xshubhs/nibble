import fs from 'fs';
import os from 'os';
import path from 'path';
import { MemoryStore } from '../main/memory/store';
import type { MemoryInput } from '../types';

/**
 * Covers the store's failure modes rather than its happy path: the log and the
 * vector file drifting apart, tombstones replayed as rows, and a model change
 * silently reinterpreting old vectors at a new width. Each of those was a real
 * bug at some point.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memstore-'));
const DIM = 4;
let pass = 0;
let fail = 0;

const ok = (name: string, cond: boolean, extra = ''): void => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ok  ' : 'FAIL  ') + name + (cond ? '' : `  <-- ${extra}`));
};

/** Normalized toy vectors, so a dot product is the cosine. */
const V = (...xs: number[]): Float32Array => {
  const v = Float32Array.from(xs);
  const n = Math.hypot(...xs);
  return v.map((x) => x / n);
};

const rec = (id: string, source: string, title: string, text: string): MemoryInput => ({
  id,
  source,
  title,
  text,
});

let s = new MemoryStore(dir, DIM).load();
ok('empty store loads', s.stats().chunks === 0);

const added = s.add([
  rec('a', 'clipboard', 'Release', 'Push the release tag so CI builds the installers for every platform.'),
  rec('b', 'notes', 'Cat', 'The cat sat on the mat and refused to move all afternoon.'),
  rec('c', 'clipboard', 'Reminder', 'Reminders should fire even when the laptop was asleep.'),
]);
ok('add returns rows', added.length === 3 && added[2].row === 2);
ok('counted', s.stats().chunks === 3);
ok('all pending', s.stats().pending === 3);

// keyword only (no vectors yet)
let r = s.search('release tag installers', null, { k: 3 });
ok('keyword finds the release chunk', r[0]?.rec.id === 'a', r.map((x) => x.rec.id).join());
ok('keyword ignores unrelated', !r.some((x) => x.rec.id === 'b'), r.map((x) => x.rec.id).join());
ok('stemming: reminder~reminders', s.search('reminder', null, { k: 1 })[0]?.rec.id === 'c');

// vectors
s.setVector(0, V(1, 0, 0, 0));
s.setVector(1, V(0, 1, 0, 0));
s.setVector(2, V(0.9, 0, 0.4, 0));
ok('embedded counted', s.stats().embedded === 3 && s.stats().pending === 0);

const vr = s.vectorSearch(V(1, 0, 0.2, 0), 3);
ok('vector ranks a and c above b', vr[0]?.[0] !== 1 && vr[1]?.[0] !== 1, JSON.stringify(vr));
ok('vector floor drops the unrelated one', !vr.some(([row]) => row === 1), JSON.stringify(vr));

// hybrid: a query with no keyword overlap should still reach 'a' via vectors
const hy = s.search('zzzz nothing matches', V(1, 0, 0, 0), { k: 3 });
ok('hybrid falls back to vectors', hy[0]?.rec.id === 'a', JSON.stringify(hy.map((h) => h.rec.id)));

// persistence
s.close();
s = new MemoryStore(dir, DIM).load();
ok('reload keeps chunks', s.stats().chunks === 3);
ok('reload keeps embedded flag', s.stats().embedded === 3);
const rv = s.vectorSearch(V(0, 1, 0, 0), 1);
ok('reload keeps vector values', rv[0]?.[0] === 1 && rv[0][1] > 0.99, JSON.stringify(rv));

// delete
ok('remove works', s.remove('b'));
ok('removed hidden from stats', s.stats().chunks === 2);
ok('removed hidden from keyword', !s.search('cat mat', null, { k: 5 }).some((x) => x.rec.id === 'b'));
ok('removed hidden from vectors', !s.vectorSearch(V(0, 1, 0, 0), 5).some(([row]) => row === 1));

s.close();
s = new MemoryStore(dir, DIM).load();
ok('tombstone survives reload', s.stats().chunks === 2, JSON.stringify(s.stats()));

// compact
const kept = s.compact();
ok('compact returns live count', kept === 2, String(kept));
ok('compact keeps data', s.stats().chunks === 2 && s.stats().embedded === 2, JSON.stringify(s.stats()));
ok('compact preserved vectors', s.vectorSearch(V(1, 0, 0, 0), 1)[0][1] > 0.99);
ok('compact shrank the file', fs.statSync(path.join(dir, 'vectors.bin')).size === 2 * DIM * 4);

// a model width change drops vectors but keeps the text
s.close();
const s2 = new MemoryStore(dir, 8).load();
ok('dim change keeps text', s2.stats().chunks === 2);
ok('dim change clears vectors', s2.stats().embedded === 0, JSON.stringify(s2.stats()));
s2.close();

// a same-width model change also has to invalidate
const s3 = new MemoryStore(dir, DIM).load();
s3.setVector(0, V(1, 0, 0, 0));
s3.saveMeta({ model: 'model-one' });
ok('ensureModel is a no-op for the same model', !s3.ensureModel('model-one'));
ok('ensureModel invalidates on a different model', s3.ensureModel('model-two'));
ok('vectors cleared by model change', s3.stats().embedded === 0, JSON.stringify(s3.stats()));

// the cosine floor has to sit between the related and unrelated ranges
import { MIN_COSINE } from '../main/memory/store';
ok('cosine floor is above measured unrelated pairs', MIN_COSINE > 0.04, String(MIN_COSINE));
ok('cosine floor is below measured related pairs', MIN_COSINE < 0.12, String(MIN_COSINE));

// related: nearest neighbours of a stored row, with siblings excluded
const relDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memrel-'));
const rel = new MemoryStore(relDir, DIM).load();
rel.add([
  rec('aaa_0', 'files', 'Deploy', 'Rotate the staging credentials every ninety days.'),
  rec('aaa_1', 'files', 'Deploy', 'Whoever is on call does the rotation.'),
  rec('bbb_0', 'clipboard', '', 'Credential rotation policy for the staging environment.'),
  rec('ccc_0', 'notes', '', 'The cat sat on the mat.'),
]);
rel.setVector(0, V(1, 0, 0, 0));
rel.setVector(1, V(1, 0, 0, 0)); // a sibling chunk of the same capture
rel.setVector(2, V(0.9, 0.44, 0, 0));
rel.setVector(3, V(0, 1, 0, 0));

const near = rel.related('aaa_0', 5);
ok('related drops the row itself', !near.some((h) => h.rec.id === 'aaa_0'));
ok(
  'related drops siblings from the same capture',
  !near.some((h) => h.rec.id === 'aaa_1'),
  near.map((h) => h.rec.id).join()
);
ok('related finds the near one', near[0]?.rec.id === 'bbb_0', near.map((h) => h.rec.id).join());
ok('related drops what is below the floor', !near.some((h) => h.rec.id === 'ccc_0'));
ok('related scores are cosines', (near[0]?.score ?? 0) > 0.85, String(near[0]?.score));
ok('related on an unknown id is empty', rel.related('nope', 5).length === 0);

rel.add([rec('ddd_0', 'notes', '', 'Something captured but not embedded yet.')]);
ok('related on an unembedded row is empty', rel.related('ddd_0', 5).length === 0);
rel.close();
fs.rmSync(relDir, { recursive: true, force: true });

// prune
s3.add([rec('old', 'x', '', 'an ancient note from long ago')]);
const oldRec = s3.byId.get('old');
if (oldRec) oldRec.ts = Date.now() - 40 * 86400000;
ok('prune by age', s3.prune({ days: 30 }) === 1);
s3.close();

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
