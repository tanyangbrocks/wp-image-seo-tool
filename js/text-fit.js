// Shared with css/style.css's .previewLine/.ovBoxText font-family and with
// html-builder.js's generated inline style - all three must stay in sync
// with what fitFontSizeToBox() below measures against, or the fitted size
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

// Picks a font-size (in the same pixel space as the caller's box
// measurements - this project always calls it in "natural image pixel"
// space, then converts the result to cqw units) that makes `text` actually
// render at close to `boxWidthPx` wide in `fontFamily`/`fontWeight`, instead
// of the previous fixed `boxHeight * 0.85` heuristic that only looked at the
// box's height and ignored the string/font's real advance width entirely -
// that mismatch is exactly why overlay text could visibly overflow (clipped
// by `overflow:hidden`) or fall short of its OCR-measured box. See
// docs/report-ocr-overlay-optimization.md §疊字覆蓋生成 §1.
//
// Binary-searches within [1, heightCap] rather than an unbounded range: the
// height cap (box height divided across however many wrapped lines the text
// has, with headroom for line-height) keeps a short/narrow string from
// being sized larger than the box could ever contain vertically, even if
// there'd be room width-wise.
export function fitFontSizeToBox(ctx, text, boxWidthPx, boxHeightPx, fontFamily, fontWeight) {
  const lines = String(text).split('\n');
  const heightCap = Math.max(1, boxHeightPx / (lines.length * 1.2));

  let lo = 1;
  let hi = Math.max(2, heightCap);
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    ctx.font = `${fontWeight} ${mid}px ${fontFamily}`;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest <= boxWidthPx) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}
