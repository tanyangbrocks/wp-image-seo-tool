// Otsu's method: given grayscale values, finds the threshold that best
// splits them into two groups (maximizes between-group variance) - the
// standard technique for separating foreground (text) from background in a
// region that's mostly two-tone.
export function otsuThreshold(grayValues, total) {
  const histogram = new Array(256).fill(0);
  for (const v of grayValues) histogram[Math.round(v)]++;

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let sumB = 0, wB = 0, maxVar = -1, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > maxVar) {
      maxVar = varBetween;
      threshold = t;
    }
  }
  return threshold;
}

// Minimum combined per-channel color difference (0-765, sum of |ΔR|+|ΔG|+|ΔB|)
// between the leftmost and rightmost thirds of a text region before it's
// classified as a gradient fill rather than flat color. No prior art was
// found for this specific check (see
// docs/report-ocr-overlay-optimization.md §疊字覆蓋生成 §3) - this threshold
// is a first-pass estimate, not empirically tuned, chosen to be well above
// the kind of channel noise plain JPEG/PNG compression or anti-aliasing
// would produce on an otherwise-flat color.
const GRADIENT_MIN_DELTA = 40;

// Extracts the actual text color from a detected-line region: splits pixels
// into two groups via Otsu thresholding, treats the smaller group (by pixel
// count) as the text - a line's bounding box is mostly background/letter-
// spacing with the glyphs themselves covering a minority of the area - and
// averages that group's *original RGB* (not just light/dark) so colored
// text comes out as its real color, not just black-or-white.
export function extractTextColor(ctx, x0, y0, x1, y1) {
  const w = Math.max(1, Math.round(x1 - x0));
  const h = Math.max(1, Math.round(y1 - y0));
  const { data } = ctx.getImageData(Math.round(x0), Math.round(y0), w, h);

  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const x = (i / 4) % w;
    pixels.push({ r, g, b, x, gray: 0.299 * r + 0.587 * g + 0.114 * b });
  }

  const threshold = otsuThreshold(pixels.map((p) => p.gray), pixels.length);
  const darkGroup = pixels.filter((p) => p.gray <= threshold);
  const lightGroup = pixels.filter((p) => p.gray > threshold);
  const textGroup = darkGroup.length <= lightGroup.length ? darkGroup : lightGroup;

  function avg(group) {
    if (!group.length) return { r: 0, g: 0, b: 0 };
    const sum = group.reduce((a, p) => ({ r: a.r + p.r, g: a.g + p.g, b: a.b + p.b }), { r: 0, g: 0, b: 0 });
    return { r: sum.r / group.length, g: sum.g / group.length, b: sum.b / group.length };
  }

  const textColor = avg(textGroup);
  const textBrightness = 0.299 * textColor.r + 0.587 * textColor.g + 0.114 * textColor.b;

  return {
    color: `rgb(${Math.round(textColor.r)}, ${Math.round(textColor.g)}, ${Math.round(textColor.b)})`,
    // Shadow contrasts against the *text* color itself (not the background),
    // so the overlay stays legible even if it lands over a busier part of
    // the real image than the original bounding box sampled.
    shadow: textBrightness > 140 ? '0 1px 3px rgba(0,0,0,0.55)' : '0 1px 3px rgba(255,255,255,0.55)',
    gradient: detectHorizontalGradient(textGroup, w)
  };
}

// Splits the already-identified text pixels into left/middle/right thirds
// (by x-position within the region) and compares their average colors - a
// flat-colored text region's thirds land close together; a genuine
// horizontal gradient fill shows a real shift across them. Returns null
// (meaning "render as flat color.textColor like before") unless the region
// is wide enough to have real per-third signal and the shift clears
// GRADIENT_MIN_DELTA, so noise/anti-aliasing on ordinary flat-color text
// doesn't get misread as a gradient.
function detectHorizontalGradient(textGroup, w) {
  if (w < 24 || textGroup.length < 12) return null;

  const bins = [[], [], []];
  for (const p of textGroup) {
    const bin = Math.min(2, Math.floor((p.x / w) * 3));
    bins[bin].push(p);
  }
  if (bins.some((b) => b.length < 3)) return null;

  function avg(group) {
    const sum = group.reduce((a, p) => ({ r: a.r + p.r, g: a.g + p.g, b: a.b + p.b }), { r: 0, g: 0, b: 0 });
    return { r: sum.r / group.length, g: sum.g / group.length, b: sum.b / group.length };
  }
  const binColors = bins.map(avg);
  const [left, , right] = binColors;
  const delta = Math.abs(left.r - right.r) + Math.abs(left.g - right.g) + Math.abs(left.b - right.b);
  if (delta < GRADIENT_MIN_DELTA) return null;

  return binColors.map((c) => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`);
}

// Applies a detected line's fill to a live DOM element (js/preview.js,
// js/editor.js): a flat `color`, or - when extractTextColor() found a real
// horizontal shift - a `background-clip: text` gradient built from the
// sampled stops instead. `-webkit-` prefixed properties are still required
// for `background-clip: text` in some browsers even though the unprefixed
// form is now widely supported.
export function applyTextFillStyle(el, line) {
  if (line.gradient && line.gradient.length) {
    el.style.color = 'transparent';
    el.style.backgroundImage = `linear-gradient(to right, ${line.gradient.join(', ')})`;
    el.style.backgroundClip = 'text';
    el.style.webkitBackgroundClip = 'text';
    el.style.webkitTextFillColor = 'transparent';
    // caret-color inherits `color` (transparent) by default - harmless on
    // js/preview.js's non-editable spans, but on js/editor.js's
    // contenteditable box it would make the text cursor invisible while
    // typing, so it's pinned to a real color whenever a gradient fill is active.
    el.style.caretColor = '#000';
  } else {
    el.style.color = line.color;
    el.style.backgroundImage = '';
    el.style.backgroundClip = '';
    el.style.webkitBackgroundClip = '';
    el.style.webkitTextFillColor = '';
    el.style.caretColor = '';
  }
}

// Same fill logic as applyTextFillStyle() above but as a CSS declaration
// string fragment, for js/html-builder.js's generated (non-live) HTML.
export function textFillCss(line) {
  if (line.gradient && line.gradient.length) {
    const stops = line.gradient.join(', ');
    return `color: transparent; background-image: linear-gradient(to right, ${stops}); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;`;
  }
  return `color: ${line.color};`;
}

// The manual editor's color picker (<input type="color">) only accepts hex,
// but detected/stored colors are "rgb(r, g, b)" strings - convert both ways.
export function rgbToHex(rgbString) {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgbString || '');
  if (!m) return '#000000';
  const toHex = (n) => Number(n).toString(16).padStart(2, '0');
  return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
}

export function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return 'rgb(0, 0, 0)';
  return `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})`;
}
