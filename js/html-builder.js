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
    return `  <div style="position: absolute; left: ${line.leftPct.toFixed(2)}%; top: ${line.topPct.toFixed(2)}%; width: ${line.widthPct.toFixed(2)}%; height: ${line.heightPct.toFixed(2)}%; display: flex; align-items: center; font-weight: 700; line-height: 1.05; white-space: nowrap; overflow: hidden; font-size: ${line.fontSizeCqw.toFixed(2)}cqw; color: ${line.color}; text-shadow: ${line.shadow};">${escapeHtml(line.text)}</div>`;
  }).join('\n');

  return `<div style="position: relative; width: 100%; container-type: inline-size; border-radius: 10px; overflow: hidden;">
  <img src="${imageDataUrl}" alt="${escapedAlt}" style="display: block; width: 100%; height: auto;" />
${lineDivs}
</div>`;
}
