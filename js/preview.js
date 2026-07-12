export function renderPreview(previewWrap, detectedLines) {
  previewWrap.querySelectorAll('.textLine').forEach((el) => el.remove());
  for (const line of detectedLines) {
    const el = document.createElement('div');
    el.className = 'textLine';
    el.textContent = line.text;
    el.style.left = line.leftPct + '%';
    el.style.top = line.topPct + '%';
    el.style.width = line.widthPct + '%';
    el.style.height = line.heightPct + '%';
    el.style.fontSize = line.fontSizeCqw + 'cqw';
    el.style.color = line.color;
    el.style.textShadow = line.shadow;
    previewWrap.appendChild(el);
  }
}
