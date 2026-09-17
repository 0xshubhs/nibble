'use strict';
const fs = require('fs');
const path = require('path');

/**
 * tsc only emits .js. The renderer's markup and stylesheet have to land beside
 * the compiled renderer, because the main process loads index.html from the
 * out/ tree at the same relative path it used in src/.
 */
const ROOT = path.join(__dirname, '..');
const pairs = [
  ['src/renderer/index.html', 'out/renderer/index.html'],
  ['src/renderer/tokens.css', 'out/renderer/tokens.css'],
  ['src/renderer/styles.css', 'out/renderer/styles.css'],
  ['src/renderer/notch.html', 'out/renderer/notch.html'],
  ['src/renderer/notch.css', 'out/renderer/notch.css'],
];

for (const [from, to] of pairs) {
  const dest = path.join(ROOT, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, from), dest);
  console.log(`  ${from} -> ${to}`);
}
