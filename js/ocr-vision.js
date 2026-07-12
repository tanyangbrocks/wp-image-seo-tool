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
        features: [{ type: 'TEXT_DETECTION' }],
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

  // annotations[0] is the whole detected block of text; the rest are
  // individual words with their own bounding polygons.
  const annotations = (response && response.textAnnotations) || [];
  const words = annotations.slice(1).map((a) => {
    const xs = a.boundingPoly.vertices.map((v) => v.x || 0);
    const ys = a.boundingPoly.vertices.map((v) => v.y || 0);
    return {
      text: a.description,
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys)
    };
  });

  return groupWordsIntoLines(words);
}
