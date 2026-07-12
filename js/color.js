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
    pixels.push({ r, g, b, gray: 0.299 * r + 0.587 * g + 0.114 * b });
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
    shadow: textBrightness > 140 ? '0 1px 3px rgba(0,0,0,0.55)' : '0 1px 3px rgba(255,255,255,0.55)'
  };
}
