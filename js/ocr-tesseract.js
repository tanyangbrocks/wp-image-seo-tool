// Tesseract line confidence (0-100) below which a detection is treated as
// noise rather than real text. Established empirically: on a photographic
// test image, the one genuine text line scored 88 while 26 noise-hallucinated
// "lines" (misread wood grain / fabric texture / food surfaces) topped out at
// 43. 60 sits with margin on both sides. Real text in low-quality/very
// stylized fonts could occasionally score under this and get dropped - if
// that turns out to happen in practice, lower this rather than removing the
// filter entirely (see CLAUDE.md).
export const MIN_LINE_CONFIDENCE = 60;

// Tesseract is loaded globally via the CDN <script> tag in index.html (not
// an ES module itself), so it's referenced here as a global rather than
// imported.
export async function recognizeWithTesseract(imageDataUrl, tesseractLangString, onProgress) {
  const { data } = await Tesseract.recognize(imageDataUrl, tesseractLangString, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(m.progress);
      }
    }
  });
  // Tesseract confidently hallucinates "text" out of photographic
  // noise/texture (wood grain, fabric weave, food surfaces) when the
  // image isn't a clean document - on a real marketing photo this
  // produced 26 garbage lines (confidence 0-43) alongside the one
  // real line (confidence 88). Discarding anything under
  // MIN_LINE_CONFIDENCE keeps the real text and drops the noise.
  return (data.lines || [])
    .filter((l) => l.text.trim() && l.confidence >= MIN_LINE_CONFIDENCE)
    .map((l) => ({ text: l.text.trim(), ...l.bbox }));
}
