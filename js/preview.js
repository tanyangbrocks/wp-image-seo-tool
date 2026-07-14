import { applyTextFillStyle } from './color.js';

// Read-only overlay preview - shows detectedLines directly on top of the
// image with no interactive handles and no contenteditable. This is what
// appears immediately after OCR completes; actual editing only happens in
// the <dialog> opened via the edit button or a double-click on this area
// (see js/editor.js and the openEditor() wiring in js/main.js).
export function renderPreview(wrap, detectedLines) {
  wrap.querySelectorAll('.previewLine').forEach((el) => el.remove());
  for (const line of detectedLines) {
    const el = document.createElement('div');
    el.className = 'previewLine';
    el.textContent = line.text;
    el.style.left = line.leftPct + '%';
    el.style.top = line.topPct + '%';
    el.style.width = line.widthPct + '%';
    el.style.height = line.heightPct + '%';
    el.style.fontSize = line.fontSizeCqw + 'cqw';
    applyTextFillStyle(el, line);
    el.style.textShadow = line.shadow;
    el.style.opacity = String(line.opacity ?? 1);
    // Cached so the "文字不透明度" peek slider (js/main.js) can scale each
    // line's own opacity by a fraction rather than overwriting it outright,
    // preserving per-block opacity differences the same way the WordPress
    // output preview's own overlay-opacity slider does (js/wp-preview.js).
    el.dataset.baseOpacity = String(line.opacity ?? 1);
    el.style.letterSpacing = (line.letterSpacing ?? 0) + 'em';
    el.style.lineHeight = String(line.lineHeight ?? 1.05);
    wrap.appendChild(el);
  }
}
