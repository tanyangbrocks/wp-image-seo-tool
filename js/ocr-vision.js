// Confidence (0-1) below which a Vision-detected word is dropped before
// line-grouping - mirrors the filtering the other two engines already do
// (MIN_LINE_CONFIDENCE in ocr-tesseract.js, MIN_CONFIDENCE_PADDLE in
// ocr-paddle.js). Vision had no confidence filtering at all until this was
// added (see docs/report-ocr-overlay-optimization.md §OCR-2.1) - unlike the
// other two thresholds, this one has NOT been empirically calibrated against
// real Vision responses (no API key was available to test with), so treat
// it as a conservative starting guess to be tuned once real usage data
// shows whether it's dropping real text or letting noise through.
export const MIN_CONFIDENCE_VISION = 0.5;

// DOCUMENT_TEXT_DETECTION (rather than TEXT_DETECTION) is requested below
// specifically because Google's docs only guarantee per-word confidence
// scores in the `fullTextAnnotation` structure for this detection type
// without any extra request flag - TEXT_DETECTION only exposes confidence
// via an `enable_text_detection_confidence_score` param whose exact effect
// on the flat `textAnnotations[]` array couldn't be confirmed from docs
// alone (see report). DOCUMENT_TEXT_DETECTION is documented for "dense
// text/paragraphs" vs. TEXT_DETECTION's "signs/labels/short text" - not a
// perfect match for scattered marketing-banner text, but it's the
// documented-reliable path to real confidence data, which matters more
// here than the detection-type's intended use case.
function extractWordsFromFullTextAnnotation(fullTextAnnotation) {
  const words = [];
  for (const page of (fullTextAnnotation && fullTextAnnotation.pages) || []) {
    for (const block of page.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const word of paragraph.words || []) {
          const text = (word.symbols || []).map((s) => s.text).join('');
          const vertices = (word.boundingBox && word.boundingBox.vertices) || [];
          if (!text.trim() || !vertices.length) continue;
          const xs = vertices.map((v) => v.x || 0);
          const ys = vertices.map((v) => v.y || 0);
          words.push({
            text,
            x0: Math.min(...xs),
            y0: Math.min(...ys),
            x1: Math.max(...xs),
            y1: Math.max(...ys),
            confidence: word.confidence ?? 1
          });
        }
      }
    }
  }
  return words;
}

// Google Vision's TEXT_DETECTION returns per-word boxes, not per-line like
// Tesseract's data.lines - cluster words whose vertical center is close
// together (relative to their own height) into the same line, then sort
// left-to-right within each line. Mirrors what Tesseract already gives us
// for free, so both engines can feed the same downstream pipeline.
export function groupWordsIntoLines(words) {
  const sorted = [...words].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const lines = [];
  for (const w of sorted) {
    const centerY = (w.y0 + w.y1) / 2;
    const height = w.y1 - w.y0;
    let line = lines.find((l) => Math.abs(l.centerY - centerY) < height * 0.6);
    if (!line) {
      line = { centerY, words: [] };
      lines.push(line);
    }
    line.words.push(w);
    line.centerY = line.words.reduce((s, ww) => s + (ww.y0 + ww.y1) / 2, 0) / line.words.length;
  }
  return lines.map((l) => {
    const ws = [...l.words].sort((a, b) => a.x0 - b.x0);
    return {
      text: ws.map((w) => w.text).join(' '),
      x0: Math.min(...ws.map((w) => w.x0)),
      y0: Math.min(...ws.map((w) => w.y0)),
      x1: Math.max(...ws.map((w) => w.x1)),
      y1: Math.max(...ws.map((w) => w.y1))
    };
  });
}

// Recognizes text via the user's own Google Cloud Vision API key. Returns
// the same shape Tesseract's lines produce: [{ text, x0, y0, x1, y1 }].
export async function recognizeWithGoogleVision(base64DataUrl, apiKey, visionLangHints) {
  const base64Content = base64DataUrl.split(',')[1];
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        image: { content: base64Content },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        imageContext: { languageHints: visionLangHints }
      }]
    })
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(errBody?.error?.message || `Google Vision API 回應錯誤（HTTP ${res.status}）`);
  }

  const json = await res.json();
  const response = json.responses && json.responses[0];
  if (response && response.error) throw new Error(response.error.message);

  const words = extractWordsFromFullTextAnnotation(response && response.fullTextAnnotation)
    .filter((w) => w.confidence >= MIN_CONFIDENCE_VISION);

  return groupWordsIntoLines(words);
}
