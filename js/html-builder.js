export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  // div.innerHTML only escapes < > & (the characters unsafe in text
  // content); this value also gets embedded inside a double-quoted alt="..."
  // attribute below, so " must be escaped too or a quote in the alt text
  // breaks out of the attribute.
  return div.innerHTML.replace(/"/g, '&quot;');
}

export function buildFinalHtml(imageDataUrl, altText, detectedLines) {
  const escapedAlt = escapeHtml(altText);
  const lineDivs = detectedLines.map((line) => {
    // opacity: per-block, live-editable in the manual overlay editor
    // (defaults to fully opaque for lines that predate that feature).
    // Every line always has an explicit widthPct/heightPct now - manually
    // added lines get a default rectangle and, like OCR-sourced ones, can be
    // resized with the editor's corner handles (see js/editor.js).
    const opacity = line.opacity ?? 1;
    return `  <div class="ovText" style="position: absolute; left: ${line.leftPct.toFixed(2)}%; top: ${line.topPct.toFixed(2)}%; width: ${line.widthPct.toFixed(2)}%; height: ${line.heightPct.toFixed(2)}%; white-space: nowrap; overflow: hidden; display: flex; align-items: center; font-weight: 700; line-height: 1.05; font-size: ${line.fontSizeCqw.toFixed(2)}cqw; color: ${line.color}; text-shadow: ${line.shadow}; opacity: ${opacity};">${escapeHtml(line.text)}</div>`;
  }).join('\n');

  return `<div style="position: relative; width: 100%; container-type: inline-size; border-radius: 10px; overflow: hidden;">
  <img src="${imageDataUrl}" alt="${escapedAlt}" style="display: block; width: 100%; height: auto;" />
${lineDivs}
</div>`;
}
