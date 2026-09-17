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

function sdSegment(px, py, ax, ay, bx, by, thickness) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h) - thickness;
}

/** Cubic bezier point at t. */
function bezier(t, p0, p1, p2, p3) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

/**
 * Distance to a bezier drawn with a stroke that thins along its length.
 * Sampled into short capsules -- a tail needs to taper to read as a tail
 * rather than a bent limb, and the taper is what sells it at small sizes.
 */
function sdTaperedCurve(px, py, p0, p1, p2, p3, wStart, wEnd, steps = 26) {
  let best = Infinity;
  let prev = bezier(0, p0, p1, p2, p3);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cur = bezier(t, p0, p1, p2, p3);
    const w = wStart + (wEnd - wStart) * t;
    const d = sdSegment(px, py, prev[0], prev[1], cur[0], cur[1], w);
    if (d < best) best = d;
    prev = cur;
  }
  return best;
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

/* ---------- the artwork: a mouse ---------- */

/**
 * Draws the mascot into an RGBA buffer.
 *
 * A mouse reads at 16px only if it is reduced to the two things that make a
 * mouse a mouse: the big round ears and the tail. Everything else -- eyes,
 * snout, feet -- turns to mud at menu-bar size, so the head is one circle,
 * the ears are two, and the tail is a single curve.
 *
 * `mono` renders a black template glyph with no background plate.
 */
function drawMouse(size, { mono = false, samples = 3 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size;
  const aa = 2 / size;

  // Geometry in normalized [-1, 1] space so it scales to any size.
  const plateHalf = 0.86;
  const plateRadius = 0.30;

  const scale = mono ? 1.18 : 0.86;      // the glyph fills more of a tray icon
  const headR = 0.42 * scale;
  const headY = 0.06 * scale;
  const earR = 0.26 * scale;
  const earX = 0.36 * scale;
  const earY = -0.30 * scale;

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let acc = null;
      const idx = (y * s + x) * 4;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = ((x + (sx + 0.5) / samples) / s) * 2 - 1;
          const py = ((y + (sy + 0.5) / samples) / s) * 2 - 1;

          const sample = Buffer.alloc(4);

          if (!mono) {
            // Rounded plate with an indigo -> violet vertical gradient.
            const plate = cover(sdRoundRect(px, py, plateHalf, plateHalf, plateRadius), aa);
            const t = clamp((py + 1) / 2, 0, 1);
            over(sample, 0,
              Math.round(79 + (139 - 79) * t),
              Math.round(70 + (92 - 70) * t),
              Math.round(229 + (246 - 229) * t),
              plate);
          }

          const ink = mono ? [0, 0, 0] : [255, 255, 255];

          // Ears first, so the head circle sits on top of their inner edge.
          const earL = cover(Math.hypot(px + earX, py - earY) - earR, aa);
          const earR_ = cover(Math.hypot(px - earX, py - earY) - earR, aa);
          over(sample, 0, ink[0], ink[1], ink[2], Math.max(earL, earR_));

          // Head.
          const head = cover(Math.hypot(px, py - headY) - headR, aa);
          over(sample, 0, ink[0], ink[1], ink[2], head);

          // Tail: emerges from behind the head's lower right, sweeps out and
          // curls back up, thinning to a point.
          const tail = cover(
            sdTaperedCurve(
              px, py,
              [0.16 * scale, 0.40 * scale],
              [0.62 * scale, 0.56 * scale],
              [0.92 * scale, 0.22 * scale],
              [0.60 * scale, 0.02 * scale],
              0.062 * scale,
              0.016 * scale
            ),
            aa
          );
          over(sample, 0, ink[0], ink[1], ink[2], tail);

          // Inner ears and eyes are punched back out in the plate colour, so
          // the face reads at large sizes and simply vanishes at 16px.
          if (!mono) {
            const t = clamp((py + 1) / 2, 0, 1);
            const plateR = Math.round(79 + (139 - 79) * t);
            const plateG = Math.round(70 + (92 - 70) * t);
            const plateB = Math.round(229 + (246 - 229) * t);

            const innerL = cover(Math.hypot(px + earX, py - earY) - earR * 0.5, aa);
            const innerR = cover(Math.hypot(px - earX, py - earY) - earR * 0.5, aa);
            over(sample, 0, plateR, plateG, plateB, Math.max(innerL, innerR));

            const eyeY = headY - 0.02 * scale;
            const eyeL = cover(Math.hypot(px + 0.15 * scale, py - eyeY) - 0.055 * scale, aa);
            const eyeR = cover(Math.hypot(px - 0.15 * scale, py - eyeY) - 0.055 * scale, aa);
            const nose = cover(Math.hypot(px, py - (headY + 0.20 * scale)) - 0.05 * scale, aa);
            over(sample, 0, plateR, plateG, plateB, Math.max(eyeL, eyeR, nose));
          }

          if (acc === null) acc = [0, 0, 0, 0];
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
  fs.writeFileSync(out, encodePNG(size, size, drawMouse(size, opts)));
  console.log(`  ${file}  ${size}x${size}`);
}

console.log('generating icons...');
write('build/icon.png', 1024, { samples: 4 });
write('assets/icon.png', 512, { samples: 4 });
write('assets/trayTemplate.png', 16, { mono: true, samples: 6 });
write('assets/trayTemplate@2x.png', 32, { mono: true, samples: 6 });
write('assets/tray.png', 32, { samples: 6 });
console.log('done.');
