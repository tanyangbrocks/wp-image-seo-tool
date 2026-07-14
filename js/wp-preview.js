import { buildFinalHtml } from './html-builder.js';

// Everything to do with the "產生 HTML" output block: building the final
// HTML string, writing it into the textarea, and rendering it inside an
// isolated iframe (the *actual* generated string, not the app's own live
// overlay state - catches buildFinalHtml() bugs the live preview wouldn't)
// plus that iframe's two peek-opacity sliders.
const outputWrap = document.getElementById('outputWrap');
const htmlOutput = document.getElementById('htmlOutput');
const wpPreviewFrame = document.getElementById('wpPreviewFrame');
const previewBgOpacity = document.getElementById('previewBgOpacity');
const previewOverlayOpacity = document.getElementById('previewOverlayOpacity');

export function generateAndPreview({ imageDataUrl, imageFileName, altText, detectedLines, naturalWidth, naturalHeight }) {
  if (!altText || !imageDataUrl) return;

  // The copyable output (what actually gets pasted into WordPress) uses just
  // the uploaded file's name as <img src> - the user uploads that same file
  // to their media library separately (this tool has no WordPress
  // credentials/API access to do that upload itself), so the filename is
  // what has to match, not a URL this tool could never construct correctly
  // anyway (it doesn't know the site's domain or WordPress's upload-date
  // subfolder).
  const html = buildFinalHtml(imageFileName, altText, detectedLines, naturalWidth, naturalHeight);
  htmlOutput.value = html;
  outputWrap.hidden = false;

  // The iframe preview calls buildFinalHtml() a second time with the real
  // base64 data URL instead of the filename - same code path as the actual
  // output (still catches any buildFinalHtml() bugs, e.g. escaping), but
  // with a resolvable image source so it visually renders instead of
  // showing a broken-image icon, letting the user check overlay-text
  // placement against the real photo before ever touching WordPress.
  const previewHtml = buildFinalHtml(imageDataUrl, altText, detectedLines, naturalWidth, naturalHeight);
  wpPreviewFrame.srcdoc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:0;font-family:-apple-system,"Microsoft JhengHei","PingFang TC",sans-serif;}</style></head><body>${previewHtml}</body></html>`;
}

// The two preview-only opacity sliders operate directly on the iframe's
// rendered DOM, not on htmlOutput/detectedLines - each srcdoc write creates
// a brand new document, so the base-opacity cache below must be re-attached
// on every 'load', which also resets the sliders to 100% as required
// ("重新按產生 HTML 時拉桿重置回 100%").
wpPreviewFrame.addEventListener('load', () => {
  const doc = wpPreviewFrame.contentDocument;
  if (!doc) return;

  previewBgOpacity.value = 100;
  previewOverlayOpacity.value = 100;
  doc.querySelectorAll('.ovText').forEach((el) => {
    el.dataset.baseOpacity = el.style.opacity || '1';
  });
});

previewBgOpacity.addEventListener('input', () => {
  const doc = wpPreviewFrame.contentDocument;
  const img = doc && doc.querySelector('img');
  if (img) img.style.opacity = String(Number(previewBgOpacity.value) / 100);
});

previewOverlayOpacity.addEventListener('input', () => {
  const doc = wpPreviewFrame.contentDocument;
  if (!doc) return;
  // Scales each line's own saved opacity by the slider fraction rather than
  // overwriting it outright, so per-block opacity differences (set in the
  // editor) stay visible while "peeking" through the overlay.
  const factor = Number(previewOverlayOpacity.value) / 100;
  doc.querySelectorAll('.ovText').forEach((el) => {
    el.style.opacity = String(Number(el.dataset.baseOpacity ?? '1') * factor);
  });
});
