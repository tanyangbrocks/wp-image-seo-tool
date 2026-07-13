// Consecutive OCR-detected lines that are only a small vertical gap apart
// (and roughly aligned horizontally) almost always come from the same
// paragraph/text block in the source image, not separate design elements -
// merging them into a single multi-line box (rather than N stacked
// single-line boxes the user would otherwise have to drag/resize/re-word
// individually) is both a more faithful representation of the source and
// less editing work.
const VERTICAL_GAP_RATIO = 0.5; // gap must be under 50% of the average line height to merge
const MIN_HORIZONTAL_OVERLAP = 0.4; // and the two lines' horizontal spans must overlap at least this much

function overlapRatio(a0, a1, b0, b1) {
  const overlap = Math.min(a1, b1) - Math.max(a0, b0);
  if (overlap <= 0) return 0;
  return overlap / Math.min(a1 - a0, b1 - b0);
}

// naturalWidth/naturalHeight are needed to give a merged box a sensible
// default line-height: fontSizeCqw is expressed as a % of the image's
// WIDTH (see main.js) while heightPct is a % of the image's HEIGHT, so
// converting "this box's height, divided across N sub-lines" into a
// line-height multiplier (a ratio *of the font size*) needs the image's
// aspect ratio to bridge the two axes - without it, reusing the flat 1.05
// single-line default on a merged multi-line box would very likely not
// match the vertical rhythm the OCR boxes actually measured.
export function mergeCloseLines(lines, naturalWidth, naturalHeight) {
  const sorted = [...lines].sort((a, b) => a.topPct - b.topPct);
  const merged = [];

  for (const line of sorted) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const gap = line.topPct - (prev.topPct + prev.heightPct);
      const avgHeight = (prev.heightPct + line.heightPct) / 2;
      const hOverlap = overlapRatio(prev.leftPct, prev.leftPct + prev.widthPct, line.leftPct, line.leftPct + line.widthPct);
      if (gap < avgHeight * VERTICAL_GAP_RATIO && hOverlap >= MIN_HORIZONTAL_OVERLAP) {
        const newLeft = Math.min(prev.leftPct, line.leftPct);
        const newRight = Math.max(prev.leftPct + prev.widthPct, line.leftPct + line.widthPct);
        const newBottom = line.topPct + line.heightPct;
        prev.text += '\n' + line.text;
        prev.leftPct = newLeft;
        prev.widthPct = newRight - newLeft;
        prev.heightPct = newBottom - prev.topPct;
        prev._lineCount = (prev._lineCount || 1) + 1;
        continue;
      }
    }
    merged.push({ ...line, _lineCount: 1 });
  }

  for (const line of merged) {
    if (line._lineCount > 1 && naturalWidth && naturalHeight && line.fontSizeCqw) {
      const perLineHeightPct = line.heightPct / line._lineCount;
      const multiplier = (perLineHeightPct * naturalHeight) / (line.fontSizeCqw * naturalWidth);
      // Clamped to a sane range - a noisy/overlapping OCR gap could
      // otherwise produce an extreme multiplier that's worse than the
      // plain single-line default would have been.
      line.lineHeight = Math.min(3, Math.max(0.8, multiplier));
    }
    delete line._lineCount;
  }

  return merged;
}
