// Small/low-resolution source images (a common case for AI-generated or
// hand-cropped marketing images) hurt OCR accuracy - text that's only a
// handful of pixels tall is exactly where engines misread/split characters
// (see docs/manual-review-checklist.md and the "苓岳"/"DO"/"音" garbled-text
// discussion this addresses). Upscaling a too-small image before handing it
// to the OCR engines is a standard, cheap preprocessing step for this.
const TARGET_LONG_EDGE_PX = 1600;
const MAX_UPSCALE_FACTOR = 3;

// Returns 1 (no-op) once the image's longer edge already reaches the
// target, so normal-sized photos are never touched - this only kicks in
// for genuinely small source images. Capped at MAX_UPSCALE_FACTOR so a
// tiny thumbnail doesn't get blown up into something absurdly large (more
// blur than detail gained past a certain point, and a bigger payload for
// engines that upload the image, e.g. Google Vision).
export function computeUpscaleFactor(naturalWidth, naturalHeight) {
  const longEdge = Math.max(naturalWidth, naturalHeight);
  if (!(longEdge > 0) || longEdge >= TARGET_LONG_EDGE_PX) return 1;
  return Math.min(MAX_UPSCALE_FACTOR, TARGET_LONG_EDGE_PX / longEdge);
}

// Draws `img` onto a bigger offscreen canvas and returns its data URL - the
// browser's own canvas scaling (bilinear/bicubic depending on engine,
// smoothing enabled below) rather than any custom resampling. Callers must
// scale any resulting OCR box coordinates back down by the same `scale`
// before using them anywhere else in the pipeline (percentage-of-natural-
// size math, color sampling against the natural-size canvas) - this
// function only prepares the OCR *input*, it doesn't touch naturalWidth/
// naturalHeight or any downstream coordinate space.
export function prepareImageForOcr(img, naturalWidth, naturalHeight) {
  const scale = computeUpscaleFactor(naturalWidth, naturalHeight);
  if (scale === 1) return { dataUrl: null, scale: 1 };

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(naturalWidth * scale);
  canvas.height = Math.round(naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/png'), scale };
}
