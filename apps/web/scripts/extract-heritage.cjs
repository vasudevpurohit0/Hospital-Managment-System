/* eslint-disable no-console */
/**
 * Lift the heritage line-art out of the approved Final-UI 2 mockup into
 * transparent PNGs under public/.
 *
 *   node scripts/extract-heritage.cjs
 *
 * Why this exists: the skyline was only ever delivered baked into the mockup
 * PNG, never as a standalone asset. Rather than approximate it by hand, this
 * derives it from the approved artwork so the page and the reference cannot
 * drift. Re-run it if the mockup is revised.
 *
 * How it works. The art is drawn over a near-white ground, so it inverts by
 * the multiply-to-alpha rule. The alpha estimate uses the MIN channel, not the
 * max: the ink is warm orange-brown (253,180,114), whose red channel is still
 * ~253, so a max-based estimate reads it as blank ground and throws the colour
 * away, leaving a grey skeleton. The min channel sees the blue drop instead
 * and recovers the real tone.
 *
 *   ground      (253,248,243) -> a 0.05     <- discarded by ALPHA_FLOOR
 *   orange wash (255,199,147) -> a 0.42
 *   warm ink    (253,180,114) -> a 0.55
 *   dark ink    (195,133,85)  -> a 0.67
 *
 * Crops avoid the login card, measured at x 872-1449, y <= 785 in the 1536x1024
 * reference. Regions holding live page text (the stat labels along the top, the
 * Hindi motto block) are excluded so they are not baked into the image twice.
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.resolve(ROOT, '../../UI/Final-UI 2.png');
const DEST = path.join(ROOT, 'public');

/** Below this, a pixel is page ground rather than ink. */
const ALPHA_FLOOR = 0.09;

if (!fs.existsSync(SRC)) {
  console.error(`Reference not found: ${SRC}`);
  process.exit(1);
}
const src = PNG.sync.read(fs.readFileSync(SRC));

/**
 * @param {string} name     output filename under public/
 * @param {number[]} crop   [x, y, width, height] in reference pixels
 * @param {number[][]} masks regions to blank, [x, y, w, h] relative to the crop
 */
function extract(name, [x0, y0, w, h], masks = []) {
  const out = new PNG({ width: w, height: h });
  let inked = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) << 2;
      const masked = masks.some((m) => x >= m[0] && x < m[0] + m[2] && y >= m[1] && y < m[1] + m[3]);
      if (masked) {
        out.data[di] = out.data[di + 1] = out.data[di + 2] = out.data[di + 3] = 0;
        continue;
      }

      const si = ((y0 + y) * src.width + (x0 + x)) << 2;
      const r = src.data[si];
      const g = src.data[si + 1];
      const b = src.data[si + 2];

      const raw = 1 - Math.min(r, g, b) / 255;
      if (raw <= ALPHA_FLOOR) {
        out.data[di] = out.data[di + 1] = out.data[di + 2] = out.data[di + 3] = 0;
        continue;
      }
      // Rescale so the floor maps to fully transparent, keeping a smooth ramp.
      const a = Math.min(1, (raw - ALPHA_FLOOR) / (1 - ALPHA_FLOOR));
      inked++;

      // Unpremultiply against the white ground to recover the ink's own colour.
      const un = (c) => Math.max(0, Math.min(255, Math.round((c - 255 * (1 - raw)) / raw)));
      out.data[di] = un(r);
      out.data[di + 1] = un(g);
      out.data[di + 2] = un(b);
      out.data[di + 3] = Math.round(a * 255);
    }
  }

  const buf = PNG.sync.write(out, { colorType: 6 });
  fs.writeFileSync(path.join(DEST, name), buf);
  console.log(
    `${name.padEnd(24)} ${w}x${h}  ink=${((inked / (w * h)) * 100).toFixed(1)}%  ${(buf.length / 1024).toFixed(0)}KB`,
  );
}

// Main temple complex and ghats, entirely left of the login card. Starts below
// the stat labels; the motto block is masked out. Both are live text in-page.
extract('mp-heritage.png', [0, 614, 872, 328], [[574, 30, 250, 150]]);

// Fainter distant cluster at the far right, below the card so unoccluded.
extract('mp-heritage-right.png', [1180, 742, 356, 200]);
