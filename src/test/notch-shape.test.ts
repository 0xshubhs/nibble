import fs from 'fs';
import path from 'path';

/**
 * The notch silhouette, checked on the emitted renderer.
 *
 * The renderer is a plain script rather than a module -- it is loaded by a
 * <script src> and must stay one -- so it cannot export anything to import
 * here. Reading the function out of the compiled file is the way to test it
 * without changing what it is.
 *
 * The property that matters most is not any single path: it is that every
 * state emits the same sequence of commands. A browser interpolates one path
 * into another only when the commands line up, so the moment they diverge the
 * panel stops growing out of the notch and starts cutting to its new size,
 * with nothing in the code to say why.
 */

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = ''): void => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ok  ' : 'FAIL  ') + name + (cond ? '' : `  <-- ${extra}`));
};

const emitted = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'notch.js'),
  'utf8'
);
const source = /function notchPath\([\s\S]*?\n\}/.exec(emitted);
ok('notchPath survives compilation', source !== null);
if (!source) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}

// The function reads window.innerWidth to centre itself; nothing else.
const window = { innerWidth: 460, innerHeight: 300 };
void window;
const notchPath = eval(`(${source[0]})`) as (
  w: number,
  h: number,
  topR: number,
  bottomR: number
) => string;

const cases: Record<string, string> = {
  collapsed: notchPath(200, 32, 7, 9),
  island: notchPath(200 + 72 * 2, 32, 9, 13),
  expanded: notchPath(460, 300, 14, 28),
  // A menu bar at the floor, with the widest radii, is the tightest real fit.
  shortest: notchPath(80, 24, 14, 28),
  // And a notch guessed absurdly small: it must degrade, not fold.
  degenerate: notchPath(40, 8, 14, 28),
};

const commands = (p: string): string => p.replace(/-?[\d.]+/g, '').replace(/\s+/g, ' ').trim();
const EXPECTED = 'M Q L Q L Q L Q Z';

for (const [name, p] of Object.entries(cases)) {
  ok(`${name}: commands are the interpolable sequence`, commands(p) === EXPECTED, commands(p));
}

for (const [name, p] of Object.entries(cases)) {
  const nums = (p.match(/-?[\d.]+/g) ?? []).map(Number);
  ok(`${name}: no NaN`, !nums.some(Number.isNaN));
  ok(`${name}: no negative coordinate`, !nums.some((v) => v < 0), p);
}

/** The vertical side must run downward: the flare has to end above the corner. */
function sideRunsDown(p: string): boolean {
  const n = (p.match(/-?[\d.]+/g) ?? []).map(Number);
  // ... Q x+t 0 x+t t   L x+t h-b ...
  const flareEndY = n[5];
  const sideEndY = n[7];
  return sideEndY >= flareEndY;
}
for (const [name, p] of Object.entries(cases)) {
  ok(`${name}: the side does not run backwards`, sideRunsDown(p), p);
}

ok('centred horizontally', cases.collapsed.startsWith('M 130.00 0'), cases.collapsed);
ok('reaches the far edge', cases.collapsed.includes('330.00 0'), cases.collapsed);
ok('expanded starts at the screen corner', cases.expanded.startsWith('M 0.00 0'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
