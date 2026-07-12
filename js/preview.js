export function renderPreview(previewWrap, detectedLines) {
  previewWrap.querySelectorAll('.textLine').forEach((el) => el.remove());
  for (const line of detectedLines) {
    const el = document.createElement('div');
    el.className = 'textLine';
    el.textContent = line.text;
    el.style.left = line.leftPct + '%';
    el.style.top = line.topPct + '%';
    // See html-builder.js buildFinalHtml() for why manually-added lines
    // (no OCR bounding box) size to content instead of a fixed percentage.
    if (line.widthPct != null && line.heightPct != null) {
      el.style.width = line.widthPct + '%';
      el.style.height = line.heightPct + '%';
    } else {
      el.classList.add('autoSize');
    }
    el.style.fontSize = line.fontSizeCqw + 'cqw';
    el.style.color = line.color;
    el.style.textShadow = line.shadow;
    el.style.opacity = String(line.opacity ?? 1);
    previewWrap.appendChild(el);
  }
}
