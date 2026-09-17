#!/usr/bin/env node
/**
 * Generates every icon the app and the installers need, with no image
 * dependencies -- just zlib and some signed-distance-field math.
 *
 *   build/icon.png            1024x1024  -> electron-builder derives .icns/.ico
 *   assets/trayTemplate.png   16x16      -> macOS menu bar (black + alpha)
 *   assets/trayTemplate@2x.png 32x32
 *   assets/tray.png           32x32      -> Windows / Linux tray (colored)
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

/* ---------- minimal PNG encoder ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- signed distance fields ---------- */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function sdRoundRect(px, py, halfW, halfH, r) {
  const qx = Math.abs(px) - halfW + r;
  const qy = Math.abs(py) - halfH + r;
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Coverage in [0,1] from a distance, antialiased over `aa` pixels. */
const cover = (d, aa) => clamp(0.5 - d / aa, 0, 1);

function over(dst, i, r, g, b, a) {
  if (a <= 0) return;
  const da = dst[i + 3] / 255;
  const outA = a + da * (1 - a);
  if (outA <= 0) return;
  for (let c = 0; c < 3; c++) {
    const src = [r, g, b][c];
    dst[i + c] = Math.round((src * a + dst[i + c] * da * (1 - a)) / outA);
  }
  dst[i + 3] = Math.round(outA * 255);
}

/* ---------- the artwork: a bite ---------- */

/**
 * Draws the mark into an RGBA buffer: a disc with a bite taken out of its
 * top-right corner, and two crumbs.
 *
 * It is one silhouette and no detail, which is the only thing that survives
 * at 16px in a menu bar. It is also strictly two-tone, so the same geometry
 * works as a colour icon, as a macOS template glyph, and as the mark on the
 * website, with nothing to keep in step but the numbers below.
 *
 * `mono` renders a black template glyph with no background plate.
 */
function drawBite(size, { mono = false, samples = 3 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size;
  const aa = 2 / size;

  // Geometry in normalized [-1, 1] space so it scales to any size.
  const plateHalf = 0.92;
  const plateRadius = 0.1; // barely rounded: the edges are the point

  const scale = mono ? 1.12 : 0.9;
  const discX = 0.0;
  const discY = 0.05 * scale;
  const discR = 0.62 * scale;
  const biteX = 0.5 * scale;
  const biteY = -0.48 * scale;
  const biteR = 0.36 * scale;

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const idx = (y * s + x) * 4;
      const acc = [0, 0, 0, 0];

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = ((x + (sx + 0.5) / samples) / s) * 2 - 1;
          const py = ((y + (sy + 0.5) / samples) / s) * 2 - 1;

          const sample = Buffer.alloc(4);

          if (!mono) {
            // A flat ink plate. No gradient: the system has no colour in it.
            const plate = cover(sdRoundRect(px, py, plateHalf, plateHalf, plateRadius), aa);
            over(sample, 0, 0, 0, 0, plate);
          }

          const ink = mono ? [0, 0, 0] : [255, 255, 255];

          const disc = cover(Math.hypot(px - discX, py - discY) - discR, aa);
          const bite = cover(Math.hypot(px - biteX, py - biteY) - biteR, aa);
          // Subtracting coverage rather than distance keeps the cut edge as
          // antialiased as the outer one.
          const bitten = disc * (1 - bite);

          const crumbA = cover(Math.hypot(px - 0.68 * scale, py - 0.34 * scale) - 0.1 * scale, aa);
          const crumbB = cover(Math.hypot(px - 0.42 * scale, py - 0.74 * scale) - 0.07 * scale, aa);

          over(sample, 0, ink[0], ink[1], ink[2], Math.max(bitten, crumbA, crumbB));

          acc[0] += sample[0];
          acc[1] += sample[1];
          acc[2] += sample[2];
          acc[3] += sample[3];
        }
      }

      const n = samples * samples;
      const a = acc[3] / n;
      if (a > 0) {
        rgba[idx] = Math.round(acc[0] / n);
        rgba[idx + 1] = Math.round(acc[1] / n);
        rgba[idx + 2] = Math.round(acc[2] / n);
        rgba[idx + 3] = Math.round(a);
      }
    }
  }
  return rgba;
}

function write(file, size, opts) {
  const out = path.join(ROOT, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, encodePNG(size, size, drawBite(size, opts)));
  console.log(`  ${file}  ${size}x${size}`);
}

console.log('generating icons...');
write('build/icon.png', 1024, { samples: 4 });
write('assets/icon.png', 512, { samples: 4 });
write('assets/trayTemplate.png', 16, { mono: true, samples: 6 });
write('assets/trayTemplate@2x.png', 32, { mono: true, samples: 6 });
write('assets/tray.png', 32, { samples: 6 });
console.log('done.');
