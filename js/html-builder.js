export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  // div.innerHTML only escapes < > & (the characters unsafe in text
  // content); this value also gets embedded inside a double-quoted alt="..."
  // attribute below, so " must be escaped too or a quote in the alt text
  // breaks out of the attribute.
  return div.innerHTML.replace(/"/g, '&quot;');
}

// Builds a JSON-LD <script> block safely: JSON.stringify handles JSON
// escaping, but a literal "</script" inside the alt text would still break
// out of the tag early, so "<" is additionally neutralized to "<"
// (the standard technique for embedding JSON inside HTML).
function buildImageObjectJsonLd(imageDataUrl, altText) {
  const json = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ImageObject',
    contentUrl: imageDataUrl,
    caption: altText,
    description: altText
  });
  return json.replace(/</g, '\\u003c');
}

export function buildFinalHtml(imageDataUrl, altText, detectedLines, naturalWidth, naturalHeight) {
  const escapedAlt = escapeHtml(altText);
  const lineDivs = detectedLines.map((line) => {
    // opacity: per-block, live-editable in the manual overlay editor
    // (defaults to fully opaque for lines that predate that feature).
    // Every line always has an explicit widthPct/heightPct now - manually
    // added lines get a default rectangle and, like OCR-sourced ones, can be
    // resized with the editor's corner handles (see js/editor.js).
    const opacity = line.opacity ?? 1;
    // white-space: pre-line (not nowrap) so a merged multi-line box's "\n"s
    // (see js/line-merge.js) render as real line breaks instead of one long
    // clipped line; a plain single-line box with no "\n" renders exactly the
    // same either way as long as it fits its box.
    return `  <div class="ovText" style="position: absolute; left: ${line.leftPct.toFixed(2)}%; top: ${line.topPct.toFixed(2)}%; width: ${line.widthPct.toFixed(2)}%; height: ${line.heightPct.toFixed(2)}%; white-space: pre-line; overflow: hidden; display: flex; align-items: center; font-weight: 700; line-height: ${line.lineHeight ?? 1.05}; letter-spacing: ${line.letterSpacing ?? 0}em; font-size: ${line.fontSizeCqw.toFixed(2)}cqw; color: ${line.color}; text-shadow: ${line.shadow}; opacity: ${opacity};">${escapeHtml(line.text)}</div>`;
  }).join('\n');

  // width/height attributes (the image's real intrinsic pixel size, distinct
  // from the CSS width:100%/height:auto that controls display size) let the
  // browser reserve the correct aspect ratio before the image loads - this
  // is what avoids Cumulative Layout Shift, a real Core Web Vitals/SEO
  // signal. loading="lazy"/decoding="async" are the standard defaults for
  // an image embedded mid-content (skip/remove "lazy" if this ends up being
  // the page's hero/above-the-fold image).
  const sizeAttrs = naturalWidth && naturalHeight ? ` width="${naturalWidth}" height="${naturalHeight}"` : '';

  // <figure>/<figcaption> (rather than a bare <div>) plus a JSON-LD
  // ImageObject block are the standard structured-HTML techniques for
  // "image SEO" - they give Google Images and AI answer engines an explicit
  // caption/description for the image on top of the alt text, instead of
  // relying on an unstructured wrapper. The figcaption repeats the alt text
  // visibly (captions are a stronger ranking signal for image search than
  // alt text alone) rather than only living in a non-visible attribute.
  //
  // The img+overlay divs are wrapped in an inner positioned <div>, separate
  // from <figcaption>, rather than making <figure> itself the positioned
  // container: percentage top/height on an absolutely positioned element
  // resolve against its containing block's height, and <figcaption> is
  // in-flow content that would otherwise inflate <figure>'s height beyond
  // the image's own rendered height - every line's top/height would then be
  // computed against that taller (wrong) number and land too low. Confirmed
  // via a synthetic test image: figure.clientHeight (526px) vs
  // img.clientHeight (501px) with the old single-container structure, a
  // systematic vertical offset that grew with each line's topPct.
  return `<!--
  SEO 提醒：<img> 的 src 目前是 base64 內嵌圖片（data:image/...），
  Google 圖片搜尋等引擎無法索引 base64 圖片，也無法被加進圖片 sitemap。
  貼上 WordPress 後，建議額外把這張圖上傳到媒體庫，再把下面 <img> 的
  src 換成媒體庫給的真實網址（例如 https://你的網域/wp-content/uploads/...），
  下面的 JSON-LD contentUrl 也一併換成同一個網址，才能真正被圖片搜尋索引。
-->
<figure style="margin: 0;">
  <div style="position: relative; width: 100%; container-type: inline-size; border-radius: 10px; overflow: hidden;">
    <img src="${imageDataUrl}" alt="${escapedAlt}"${sizeAttrs} loading="lazy" decoding="async" style="display: block; width: 100%; height: auto;" />
${lineDivs}
  </div>
  <figcaption style="margin-top: 8px; font-size: 13px; color: #666; text-align: center;">${escapedAlt}</figcaption>
</figure>
<script type="application/ld+json">${buildImageObjectJsonLd(imageDataUrl, altText)}</script>`;
}
