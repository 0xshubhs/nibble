import fs from 'fs';
import path from 'path';

/**
 * What the notch decides to show progress for, checked on the emitted
 * renderer.
 *
 * Same trick as the silhouette test: the renderer is a plain script and
 * cannot export, so the functions are read out of the compiled file.
 *
 * The rule being pinned here is the one that is easy to regress and
 * invisible when you do. A model download owns the strip, because it happens
 * once, blocks search entirely and is the only time the app looks broken
 * while working. The embedding backlog does not, because it is ordinary
 * background work that can run for hours -- if it took the strip, a busy
 * machine would never show what is playing again. Both fill the hairline.
 */

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = ''): void => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ok  ' : 'FAIL  ') + name + (cond ? '' : `  <-- ${extra}`));
};

const emitted = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'notch.js'), 'utf8');

const grab = (name: string): string | null => {
  const m = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`).exec(emitted);
  return m ? m[0] : null;
};

const busySrc = grab('busyFrom');
const clampSrc = grab('clampPct');
ok('busyFrom survives compilation', busySrc !== null);
ok('clampPct survives compilation', clampSrc !== null);
if (!busySrc || !clampSrc) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}

type Busy = { label: string | null; pct: number } | null;

// Both declarations go into one scope and the caller is handed out of it, so
// busyFrom closes over clampPct the way it does in the renderer. Evaluating
// them as a comma expression instead does not work: a function declaration
// there is an expression whose value is thrown away, and the reference from
// inside busyFrom finds nothing.
const busyFrom = eval(
  `(() => { ${clampSrc}; ${busySrc}; return busyFrom; })()`
) as (state: unknown) => Busy;

/** A snapshot with only the fields this reads. */
const snap = (embedder: Record<string, unknown>, embedded = 0, pending = 0): unknown => ({
  memory: { stats: { embedded, pending, embedder } },
});

const ready = { status: 'ready', ready: true, progress: 100 };

/* ---------------- nothing to say ---------------- */

ok('no memory yet: nothing', busyFrom({}) === null);
ok('idle embedder: nothing', busyFrom(snap(ready, 10, 0)) === null);
// 'loading' has no number behind it, and a bar that fills is a promise about
// how long something will take.
ok(
  'indeterminate loading: nothing',
  busyFrom(snap({ status: 'loading', ready: false, progress: 0 }, 0, 0)) === null
);
ok(
  'backlog but embedder not ready: nothing',
  busyFrom(snap({ status: 'loading', ready: false, progress: 0 }, 5, 5)) === null
);

/* ---------------- the download owns the strip ---------------- */

const dl = busyFrom(snap({ status: 'downloading', ready: false, progress: 42 }, 0, 0));
ok('download reports a label', dl?.label === 'Downloading model', JSON.stringify(dl));
ok('download reports its percentage', dl?.pct === 42, JSON.stringify(dl));

// A download while a backlog also exists must still be the thing that shows:
// the backlog cannot drain until the model has landed anyway.
const both = busyFrom(snap({ status: 'downloading', ready: false, progress: 7 }, 100, 900));
ok('download outranks the backlog', both?.label === 'Downloading model', JSON.stringify(both));

/* ---------------- the backlog stays quiet ---------------- */

const idx = busyFrom(snap(ready, 1284, 506));
ok('backlog has no label', idx !== null && idx.label === null, JSON.stringify(idx));
ok(
  'backlog percentage is the embedded share',
  idx !== null && Math.round(idx.pct) === Math.round((1284 / 1790) * 100),
  JSON.stringify(idx)
);

/* ---------------- percentages stay percentages ---------------- */

const over = busyFrom(snap({ status: 'downloading', ready: false, progress: 140 }, 0, 0));
ok('a percentage over 100 is clamped', over?.pct === 100, JSON.stringify(over));

const under = busyFrom(snap({ status: 'downloading', ready: false, progress: -3 }, 0, 0));
ok('a negative percentage is clamped', under?.pct === 0, JSON.stringify(under));

const nan = busyFrom(snap({ status: 'downloading', ready: false, progress: NaN }, 0, 0));
ok('a missing percentage reads as zero, not NaN', nan?.pct === 0, JSON.stringify(nan));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
