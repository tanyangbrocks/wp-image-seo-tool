import { PADDLE_SCRIPTS, PADDLE_DEFAULT_SCRIPT } from './languages.js';

// Loaded from CDN as an ES module only when this engine is actually used
// (the WASM+ONNX runtime is a much bigger download than Tesseract's CDN
// <script> tag). jsdelivr's `+esm` endpoint, not esm.sh - esm.sh works for
// this package too, but broke @paddleocr/paddleocr-js (the alternative we
// evaluated and rejected) with a `process.binding` error during Phase A, so
// jsdelivr was kept for consistency. See docs/plan-paddleocr-evaluation.md.
const PPU_PADDLE_CDN = 'https://cdn.jsdelivr.net/npm/ppu-paddle-ocr/web/+esm';

// Empirically (docs/plan-paddleocr-evaluation.md Phase A), this model does
// NOT hallucinate text out of photo texture the way Tesseract does - a pure
// wood-grain test image correctly came back with zero results, and real
// text scored 0.95-0.99. This threshold is a conservative safety net, not a
// proven necessity like Tesseract's empirically-tuned MIN_LINE_CONFIDENCE.
export const MIN_CONFIDENCE_PADDLE = 0.3;

// One service instance per script model, lazily created and cached across
// images so the (multi-MB) model asset is only downloaded once per session.
const serviceCache = new Map();

async function getService(scriptKey) {
  if (serviceCache.has(scriptKey)) return serviceCache.get(scriptKey);

  const mod = await import(/* webpackIgnore: true */ PPU_PADDLE_CDN);
  const scriptDef = PADDLE_SCRIPTS.find((s) => s.key === scriptKey) || PADDLE_SCRIPTS.find((s) => s.key === PADDLE_DEFAULT_SCRIPT);
  const options = scriptDef.preset ? { model: mod[scriptDef.preset] } : undefined;

  const service = new mod.PaddleOcrService(options);
  await service.initialize();
  serviceCache.set(scriptKey, service);
  return service;
}

// Returns the same shape the other engines produce: [{ text, x0, y0, x1, y1 }].
export async function recognizeWithPaddleOCR(imageDataUrl, scriptKey) {
  const service = await getService(scriptKey);

  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('圖片載入失敗'));
    el.src = imageDataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);

  const result = await service.recognize(canvas, { flatten: true });
  return result.results
    .filter((r) => r.text.trim() && r.confidence >= MIN_CONFIDENCE_PADDLE)
    .map((r) => ({
      text: r.text.trim(),
      x0: r.box.x,
      y0: r.box.y,
      x1: r.box.x + r.box.width,
      y1: r.box.y + r.box.height
    }));
}
