// Consecutive OCR-detected lines that are only a small vertical gap apart
// (and roughly aligned horizontally) almost always come from the same
// paragraph/text block in the source image, not separate design elements -
// merging them into a single multi-line box (rather than N stacked
// single-line boxes the user would otherwise have to drag/resize/re-word
// individually) is both a more faithful representation of the source and
// less editing work. Merging chains naturally for any number of lines: each
// newly-merged line extends `prev`'s box in place, so a third, fourth, etc.
// line compares its gap against the already-extended box, not just the
// original first line - a single text box can end up with many rows.
const VERTICAL_GAP_RATIO = 0.5; // gap must be under 50% of the average line height to merge
const MIN_HORIZONTAL_OVERLAP = 0.4; // and the two lines' horizontal spans must overlap at least this much

function overlapRatio(a0, a1, b0, b1) {
  const overlap = Math.min(a1, b1) - Math.max(a0, b0);
  if (overlap <= 0) return 0;
  return overlap / Math.min(a1 - a0, b1 - b0);
}

// Only merges geometry/text - deliberately does NOT touch fontSizeCqw or
// derive a line-height here. Both depend on the box's *final* font-size,
// which isn't known yet at this point in the pipeline (js/main.js now fits
// font-size/letter-spacing *after* merging, against each merged box's real
// final dimensions and joined text, rather than per original OCR line
// before merging - see js/text-fit.js). `lineCount` is left on the
// returned lines (not a private/deleted temp field) specifically so that
// later line-height step can divide the merged height across the right
// number of rows.
export function mergeCloseLines(lines) {
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
        prev.lineCount = (prev.lineCount || 1) + 1;
        continue;
      }
    }
    merged.push({ ...line, lineCount: 1 });
  }

  return merged;
}
