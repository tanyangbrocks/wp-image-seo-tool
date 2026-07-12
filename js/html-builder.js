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
    // opacity: per-block, editable in the manual overlay editor (defaults to
    // fully opaque for lines that predate that feature). Sizing: OCR-sourced
    // lines keep their fixed bounding-box width/height (nowrap+overflow
    // hidden, matches the region that was actually sampled for color);
    // lines added manually in the editor have no bounding box to inherit, so
    // widthPct/heightPct are left null and they size to their own content
    // instead (see docs/plan-manual-overlay-editor.md "先維持自動").
    const opacity = line.opacity ?? 1;
    const hasBox = line.widthPct != null && line.heightPct != null;
    const sizing = hasBox
      ? `width: ${line.widthPct.toFixed(2)}%; height: ${line.heightPct.toFixed(2)}%; white-space: nowrap; overflow: hidden;`
      : `width: auto; height: auto; white-space: pre;`;
    return `  <div class="ovText" style="position: absolute; left: ${line.leftPct.toFixed(2)}%; top: ${line.topPct.toFixed(2)}%; ${sizing} display: flex; align-items: center; font-weight: 700; line-height: 1.05; font-size: ${line.fontSizeCqw.toFixed(2)}cqw; color: ${line.color}; text-shadow: ${line.shadow}; opacity: ${opacity};">${escapeHtml(line.text)}</div>`;
  }).join('\n');

  return `<div style="position: relative; width: 100%; container-type: inline-size; border-radius: 10px; overflow: hidden;">
  <img src="${imageDataUrl}" alt="${escapedAlt}" style="display: block; width: 100%; height: auto;" />
${lineDivs}
</div>`;
}
