import { OVERLAY_FONT_STACK, OVERLAY_FONT_WEIGHT } from './text-fit.js';
import { textFillCss } from './color.js';

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
function buildImageObjectJsonLd(imageSrc, altText) {
  const json = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ImageObject',
    contentUrl: imageSrc,
    caption: altText,
    description: altText
  });
  return json.replace(/</g, '\\u003c');
}

export function buildFinalHtml(imageSrc, altText, detectedLines, naturalWidth, naturalHeight) {
  const escapedAlt = escapeHtml(altText);
  const escapedSrc = escapeHtml(imageSrc);
  const lineDivs = detectedLines.map((line) => {
    // opacity: per-block, live-editable in the manual overlay editor
    // (defaults to fully opaque for lines that predate that feature).
    // Every line always has an explicit widthPct/heightPct now - manually
    // added lines get a default rectangle and, like OCR-sourced ones, can be
    // resized with the editor's corner handles (see js/editor.js).
    const opacity = line.opacity ?? 1;
    // white-space: pre (not pre-line/nowrap) so a merged multi-line box's
    // "\n"s (see js/line-merge.js) render as real line breaks, but the
    // browser can never *additionally* wrap within one of those lines if
    // js/text-fit.js's fitted font-size/letter-spacing doesn't land
    // pixel-perfect on the box's actual rendered width (small measurement/
    // rounding gaps between its canvas-based estimate and real CSS layout
    // are normal) - confirmed real bug: pre-line let the browser wrap a
    // CJK character onto a new line when a fit was even a few px too wide,
    // which cascaded into pushing every subsequent line down and off the
    // bottom edge under overflow:hidden, silently deleting whole lines of
    // text from the shipped HTML. A single line clipping a few px narrower
    // than intended (pre-line's own known residual, still possible here
    // too) is a far smaller problem than a line disappearing outright.
    // toFixed(3) on line-height/letter-spacing: both are now derived from
    // canvas.measureText() ratios (js/text-fit.js) rather than round slider
    // values, so without rounding here they'd carry ~17 digits of float
    // noise into the shipped HTML (harmless to render, just ugly source).
    const lineHeight = (line.lineHeight ?? 1.05).toFixed(3);
    const letterSpacing = (line.letterSpacing ?? 0).toFixed(3);
    return `  <div class="ovText" style="position: absolute; left: ${line.leftPct.toFixed(2)}%; top: ${line.topPct.toFixed(2)}%; width: ${line.widthPct.toFixed(2)}%; height: ${line.heightPct.toFixed(2)}%; white-space: pre; overflow: hidden; display: flex; align-items: center; font-family: ${OVERLAY_FONT_STACK}; font-weight: ${OVERLAY_FONT_WEIGHT}; line-height: ${lineHeight}; letter-spacing: ${letterSpacing}em; font-size: ${line.fontSizeCqw.toFixed(2)}cqw; ${textFillCss(line)} text-shadow: ${line.shadow}; opacity: ${opacity};">${escapeHtml(line.text)}</div>`;
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
  SEO 提醒：<img> 的 src 目前只有檔名（${escapedSrc}），不是完整網址——
  請先把這張圖上傳到 WordPress 媒體庫（檔名務必跟這裡一致，否則抓不到
  圖），瀏覽器才找得到圖片；下面的 JSON-LD contentUrl 也是同一個檔名，
  一併確認媒體庫的檔名有對上。
-->
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@100..900&display=swap">
<figure style="margin: 0;">
  <div style="position: relative; width: 100%; container-type: inline-size; border-radius: 10px; overflow: hidden;">
    <img src="${escapedSrc}" alt="${escapedAlt}"${sizeAttrs} loading="lazy" decoding="async" style="display: block; width: 100%; height: auto;" />
${lineDivs}
  </div>
  <figcaption style="margin-top: 8px; font-size: 13px; color: #666; text-align: center;">${escapedAlt}</figcaption>
</figure>
<script type="application/ld+json">${buildImageObjectJsonLd(imageSrc, altText)}</script>`;
}
