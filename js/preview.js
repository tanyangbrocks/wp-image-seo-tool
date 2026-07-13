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
    el.style.color = line.color;
    el.style.textShadow = line.shadow;
    el.style.opacity = String(line.opacity ?? 1);
    wrap.appendChild(el);
  }
}
