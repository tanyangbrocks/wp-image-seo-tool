// Shared with css/style.css's .previewLine/.ovBoxText font-family and with
// html-builder.js's generated inline style - all three must stay in sync
// with what fitTextToBox() below measures against, or the fitted size
// will be calibrated for a different font than what actually renders.
// Noto Sans TC first (loaded via Google Fonts CDN in index.html - broad
// Traditional Chinese + Latin coverage, see
// docs/report-ocr-overlay-optimization.md §疊字覆蓋生成 §2), falling back to
// whatever CJK/system sans-serif fonts the visitor's OS already has.
// Single-quoted (not the more common double-quoted CSS style) because
// html-builder.js interpolates this straight into a double-quoted HTML
// `style="..."` attribute - a literal `"` here would terminate that
// attribute early and silently truncate every style property after
// font-family (confirmed: this exact bug shipped once already, caught by
// checking the generated <div>'s raw style attribute value, not just its
// resolved computed style).
export const OVERLAY_FONT_STACK = "'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', -apple-system, sans-serif";
export const OVERLAY_FONT_WEIGHT = 700;

// Matches the manual "字距" slider's own range (index.html #panelLetterSpacing)
// so an auto-computed value is never outside what the user could dial in by
// hand anyway.
const MIN_LETTER_SPACING_EM = -0.05;
const MAX_LETTER_SPACING_EM = 0.5;
const REFERENCE_FONT_SIZE = 100;
// Divides a merged multi-line box's height across its lines before sizing -
// >1 so lines get a little breathing room rather than sizing as if glyphs
// were stacked with zero gap.
const LINE_GAP_FACTOR = 1.2;

// Picks BOTH a font-size and a letter-spacing (in the same pixel space as
// the caller's box measurements - this project always calls it in "natural
// image pixel" space, then converts font-size to cqw units) that reproduce
// `text`'s real OCR box as closely as possible in `fontFamily`/`fontWeight`,
// instead of the old approach of only ever adjusting font-size and assuming
// letter-spacing 0. That older approach conflated two different signals:
// the box's HEIGHT was only used as an upper *cap* (never actually matched),
// and its WIDTH was matched purely by shrinking font-size - so a string
// whose original font was simply more tracked-out or more condensed than
// this overlay's generic font would come out too small or too large
// respectively, even though its width matched. Splitting the two axes
// apart - font-size fits height, letter-spacing fits the width gap left
// over at that height - lets both be reproduced accurately instead of
// trading one off against the other. See
// docs/report-ocr-overlay-optimization.md §疊字覆蓋生成 §1.
// `lineGapFactor` defaults to the LINE_GAP_FACTOR guess, but callers fitting
// a multi-line merged box can pass in a real, just-measured line-height
// multiplier instead: line-height and font-size are circularly related for
// multi-line text (line-height determines how much vertical room each line
// actually gets, but an accurate line-height can only be derived from a
// fit's resulting font-size in the first place) - js/main.js does one extra
// fitTextToBox() pass with the real multiplier once it's known, which
// converges close enough without a full iterative solver.
export function fitTextToBox(ctx, text, boxWidthPx, boxHeightPx, fontFamily, fontWeight, lineGapFactor = LINE_GAP_FACTOR) {
  const lines = String(text).split('\n');

  // Step 1: font-size from real glyph metrics, not a flat height*constant
  // guess - actualBoundingBoxAscent/Descent give the tight rendered height
  // of the glyphs actually in this string (differs from the font's generic
  // em-square metrics, e.g. strings with no descenders measure shorter),
  // measured once at a reference size and scaled linearly since font
  // metrics scale proportionally with font-size.
  ctx.font = `${fontWeight} ${REFERENCE_FONT_SIZE}px ${fontFamily}`;
  let refGlyphHeight = 0;
  for (const line of lines) {
    const m = ctx.measureText(line || ' ');
    const ascent = m.actualBoundingBoxAscent || REFERENCE_FONT_SIZE * 0.75;
    const descent = m.actualBoundingBoxDescent || REFERENCE_FONT_SIZE * 0.2;
    refGlyphHeight = Math.max(refGlyphHeight, ascent + descent);
  }
  if (!(refGlyphHeight > 0)) refGlyphHeight = REFERENCE_FONT_SIZE * 0.7;

  const perLineHeightPx = boxHeightPx / (lines.length * lineGapFactor);
  let fontSizePx = Math.max(1, REFERENCE_FONT_SIZE * (perLineHeightPx / refGlyphHeight));

  // Step 2: at that font-size, measure the widest line's *natural*
  // (letter-spacing 0) width and derive the per-character spacing that
  // would close the remaining gap to the box width.
  ctx.font = `${fontWeight} ${fontSizePx}px ${fontFamily}`;
  let widestLine = '';
  let naturalWidth = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w >= naturalWidth) {
      naturalWidth = w;
      widestLine = line;
    }
  }
  const charCount = Array.from(widestLine).length; // code points, not UTF-16 units - matters for astral-plane/CJK edge cases

  let letterSpacingEm = 0;
  if (charCount > 1 && naturalWidth > 0) {
    const neededPxPerGap = (boxWidthPx - naturalWidth) / (charCount - 1);
    letterSpacingEm = Math.max(MIN_LETTER_SPACING_EM, Math.min(MAX_LETTER_SPACING_EM, neededPxPerGap / fontSizePx));
  }

  // If clamping letter-spacing still leaves the line wider than its box
  // (only happens when even the minimum allowed spacing isn't tight
  // enough), fall back to shrinking font-size proportionally - keeps the
  // "never silently overflow past overflow:hidden" guarantee the old
  // height-only heuristic had, at the cost of some height accuracy for
  // just that string.
  const renderedWidth = naturalWidth + letterSpacingEm * fontSizePx * Math.max(0, charCount - 1);
  if (renderedWidth > boxWidthPx) {
    fontSizePx *= boxWidthPx / renderedWidth;
  }

  return { fontSizePx, letterSpacingEm };
}
