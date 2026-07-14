import { PADDLE_DEFAULT_SCRIPT } from './languages.js';
import { extractTextColor } from './color.js';
import { recognizeWithGoogleVision } from './ocr-vision.js';
import { recognizeWithTesseract } from './ocr-tesseract.js';
import { recognizeWithPaddleOCR, preloadDefaultModel } from './ocr-paddle.js';
import { prepareImageForOcr } from './image-prep.js';
import { mergeCloseLines } from './line-merge.js';
import { fitTextToBox, OVERLAY_FONT_STACK, OVERLAY_FONT_WEIGHT } from './text-fit.js';
import { renderPreview } from './preview.js';
import { mountEditor } from './editor.js';
import { getSelectedLanguages, getSelectedEngine, getPaddleScriptKey, getApiKey } from './settings-menu.js';
import { generateAndPreview } from './wp-preview.js';

const landingSection = document.getElementById('landingSection');
const workspaceSection = document.getElementById('workspaceSection');
const landingChooseBtn = document.getElementById('landingChooseBtn');
const chooseImageBtn = document.getElementById('chooseImageBtn');
const backBtn = document.getElementById('backBtn');
const backConfirmDialog = document.getElementById('backConfirmDialog');
const backConfirmYes = document.getElementById('backConfirmYes');
const backConfirmNo = document.getElementById('backConfirmNo');
const imageInput = document.getElementById('imageInput');
const ocrStatus = document.getElementById('ocrStatus');
const previewImg = document.getElementById('previewImg');
const previewCanvasWrap = document.getElementById('previewCanvasWrap');
const previewCanvasImg = document.getElementById('previewCanvasImg');
const openEditorBtn = document.getElementById('openEditorBtn');
const previewOpacityControls = document.getElementById('previewOpacityControls');
const previewCanvasBgOpacity = document.getElementById('previewCanvasBgOpacity');
const previewCanvasOverlayOpacity = document.getElementById('previewCanvasOverlayOpacity');
const editorDialog = document.getElementById('editorDialog');
const closeEditorBtn = document.getElementById('closeEditorBtn');
const altInput = document.getElementById('altInput');
const generateBtn = document.getElementById('generateBtn');
const outputWrap = document.getElementById('outputWrap');
const htmlOutput = document.getElementById('htmlOutput');
const copyBtn = document.getElementById('copyBtn');
const copiedMsg = document.getElementById('copiedMsg');

// Warm up PaddleOCR's model download+init in the background as soon as the
// page loads (settings-menu.js's own top-level code, including restoring a
// saved Vision API key, has already run by this point - ES module imports
// fully evaluate before this file's own top-level code continues - so this
// correctly sees a returning Vision user's restored engine choice) rather
// than waiting for the first upload to pay that cold-start cost.
// requestIdleCallback lets initial render finish first; falls back to a
// short timeout on browsers that lack it.
if (getSelectedEngine() === 'paddle') {
  // A timeout is required here, not just a nicety: browsers throttle
  // requestIdleCallback hard (sometimes indefinitely) in hidden/background
  // tabs, which would defeat the point of preloading for anyone who opens
  // this page in a background tab.
  const runWhenIdle = window.requestIdleCallback || ((cb) => setTimeout(cb, 200));
  runWhenIdle(() => preloadDefaultModel(), { timeout: 2000 });
}

let imageDataUrl = null;
let imageFileName = '';
let naturalWidth = 0;
let naturalHeight = 0;
let detectedLines = []; // { text, leftPct, topPct, widthPct, heightPct, fontSizeCqw, color, shadow, opacity }
// Bumped once per upload; a slow upload's async chain (image decode -> OCR,
// which can take several seconds) checks this before writing back any
// results, so a second upload started before the first finishes can't have
// its state clobbered by the first one's now-stale results landing late.
let uploadToken = 0;

// #landingChooseBtn (on #landingSection) just proxies to the real file
// input rather than being a second one - it lives inside #workspaceSection
// (index.html), unchanged since before the landing screen existed.
landingChooseBtn.addEventListener('click', () => imageInput.click());
// #chooseImageBtn replaces the native file-picker button (hidden, see
// index.html) with a styled trigger matching #landingChooseBtn's look.
chooseImageBtn.addEventListener('click', () => imageInput.click());

// Shared by resetWorkspace() and a fresh upload's start (see the 'change'
// handler below) - both need to blank out whatever the *previous* image's
// results left on screen before showing anything new.
function clearResultsUI() {
  detectedLines = [];
  altInput.value = '';
  generateBtn.disabled = true;
  outputWrap.hidden = true;
  openEditorBtn.hidden = true;
  previewOpacityControls.hidden = true;
}

// "← 上一步" - confirms before discarding whatever's currently loaded/being
// processed and scrolling back to the landing screen. Bumping uploadToken
// reuses the same race-guard every async OCR step already checks (see
// imageInput's 'change' handler below), so an in-flight recognition call
// that finishes after the user has already backed out silently discards
// its result instead of clobbering the now-reset UI.
function resetWorkspace() {
  ++uploadToken;
  imageDataUrl = null;
  imageFileName = '';
  naturalWidth = 0;
  naturalHeight = 0;
  imageInput.value = '';
  previewImg.removeAttribute('src');
  previewCanvasImg.removeAttribute('src');
  renderPreview(previewCanvasWrap, []);
  clearResultsUI();
  ocrStatus.className = '';
  ocrStatus.style.display = 'none';
  ocrStatus.textContent = '';
}
backBtn.addEventListener('click', () => backConfirmDialog.showModal());
backConfirmNo.addEventListener('click', () => backConfirmDialog.close());
backConfirmYes.addEventListener('click', () => {
  backConfirmDialog.close();
  resetWorkspace();
  landingSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// The right-panel preview is read-only; actual editing happens in
// #editorDialog, opened only via the edit button or a double-click on the
// preview. mountEditor() populates the dialog's interactive canvas against
// the same detectedLines array; closing the dialog re-renders the read-only
// preview so it reflects whatever was changed (live edits, no save/cancel).
function openEditor() {
  mountEditor(detectedLines, imageDataUrl);
  editorDialog.showModal();
}
function syncPreviewFromEditor() {
  renderPreview(previewCanvasWrap, detectedLines);
}
openEditorBtn.addEventListener('click', openEditor);
previewCanvasWrap.addEventListener('dblclick', openEditor);
// The explicit "完成" button resyncs directly rather than relying solely on
// the dialog's native 'close' event - kept the listener below too (it's the
// only path that runs for Esc-key dismissal), but a button click shouldn't
// depend on that event firing to do the one thing this button is for.
closeEditorBtn.addEventListener('click', () => {
  editorDialog.close();
  syncPreviewFromEditor();
});
editorDialog.addEventListener('close', syncPreviewFromEditor);

previewCanvasBgOpacity.addEventListener('input', () => {
  previewCanvasImg.style.opacity = String(Number(previewCanvasBgOpacity.value) / 100);
});

previewCanvasOverlayOpacity.addEventListener('input', () => {
  // Scales each line's own baseOpacity by the slider fraction rather than
  // overwriting it outright, so per-block opacity differences (set in the
  // editor) stay visible while "peeking" - same pattern as the WordPress
  // output preview's own overlay-opacity slider (js/wp-preview.js).
  const factor = Number(previewCanvasOverlayOpacity.value) / 100;
  previewCanvasWrap.querySelectorAll('.previewLine').forEach((el) => {
    el.style.opacity = String(Number(el.dataset.baseOpacity ?? '1') * factor);
  });
});

altInput.addEventListener('input', () => {
  generateBtn.disabled = !altInput.value.trim() || !imageDataUrl;
});

generateBtn.addEventListener('click', () => {
  generateAndPreview({ imageDataUrl, imageFileName, altText: altInput.value.trim(), detectedLines, naturalWidth, naturalHeight });
});

imageInput.addEventListener('change', async () => {
  const file = imageInput.files[0];
  if (!file) return;

  // Scrolls before validation (not only on success) so a config error
  // below ("請先填...金鑰" etc.) is actually visible - #ocrStatus lives
  // inside #workspaceSection, which is off-screen below #landingSection
  // until this runs, so a validation failure with no scroll would silently
  // render an error message the user can't see.
  workspaceSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const engine = getSelectedEngine();
  const selectedLanguages = getSelectedLanguages();
  // Only Tesseract/Google Vision need a language pick - PaddleOCR's default
  // model already covers CJK+Latin with no selection required (see
  // js/languages.js PADDLE_SCRIPTS comment).
  if (engine !== 'paddle' && !selectedLanguages.length) {
    ocrStatus.className = 'error';
    ocrStatus.style.display = 'block';
    ocrStatus.textContent = '請至少勾選一種語言再上傳圖片';
    imageInput.value = '';
    return;
  }
  if (engine === 'vision' && !getApiKey()) {
    ocrStatus.className = 'error';
    ocrStatus.style.display = 'block';
    ocrStatus.textContent = '請先填 Google Cloud Vision API 金鑰再上傳圖片（或改選其他引擎）';
    imageInput.value = '';
    return;
  }

  const thisUploadToken = ++uploadToken;

  const reader = new FileReader();
  reader.onload = async (e) => {
    if (thisUploadToken !== uploadToken) return; // superseded by a newer upload before the file even finished reading
    imageDataUrl = e.target.result;
    imageFileName = file.name;
    clearResultsUI();

    ocrStatus.className = '';
    ocrStatus.style.display = 'block';
    ocrStatus.textContent = '載入圖片中…';

    const img = new Image();
    img.onerror = () => {
      if (thisUploadToken !== uploadToken) return;
      ocrStatus.className = 'error';
      ocrStatus.textContent = '圖片載入失敗（檔案可能已損壞，或不是有效的圖片格式），請重新選擇圖片';
    };
    img.onload = async () => {
      if (thisUploadToken !== uploadToken) return; // a newer upload started while this image was decoding
      naturalWidth = img.naturalWidth;
      naturalHeight = img.naturalHeight;

      // Offscreen canvas for sampling the real text color behind each detected line.
      const canvas = document.createElement('canvas');
      canvas.width = naturalWidth;
      canvas.height = naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      previewImg.src = imageDataUrl;
      previewCanvasImg.src = imageDataUrl;
      previewCanvasBgOpacity.value = 100;
      previewCanvasImg.style.opacity = 1;
      previewCanvasOverlayOpacity.value = 100;
      // Read-only preview only, no boxes yet - the interactive editor stays
      // unmounted until openEditor() runs (button click or double-click).
      renderPreview(previewCanvasWrap, []);
      // Now that there's an image, reveal the edit trigger and the peek
      // slider - both stayed hidden while the panel was blank.
      openEditorBtn.hidden = false;
      previewOpacityControls.hidden = false;

      ocrStatus.textContent = '正在辨識圖片中的文字與位置…';
      try {
        let rawLines = null;

        const tesseractLangString = selectedLanguages.map((l) => l.tesseract).join('+');
        const visionLangHints = selectedLanguages.map((l) => l.vision);
        const paddleScriptKey = getPaddleScriptKey();

        // Small/low-res source images hurt OCR accuracy (text only a
        // handful of pixels tall is where engines misread/split
        // characters) - upscale before recognition when the image is
        // below a reasonable working resolution (see js/image-prep.js).
        // ocrScale is 1 (no-op) for images that are already big enough.
        const { dataUrl: upscaledDataUrl, scale: ocrScale } = prepareImageForOcr(img, naturalWidth, naturalHeight);
        const ocrInputDataUrl = upscaledDataUrl || imageDataUrl;

        if (engine === 'vision') {
          try {
            ocrStatus.textContent = '正在用 Google Cloud Vision 辨識圖片中的文字與位置…';
            rawLines = await recognizeWithGoogleVision(ocrInputDataUrl, getApiKey(), visionLangHints);
          } catch (cloudErr) {
            // Fall back to PaddleOCR (the default engine) rather than
            // dead-ending the whole flow on a bad/expired key or network hiccup.
            ocrStatus.textContent = `Google Cloud Vision 辨識失敗（${cloudErr.message}），改用 PaddleOCR…`;
            rawLines = await recognizeWithPaddleOCR(ocrInputDataUrl, PADDLE_DEFAULT_SCRIPT);
          }
        } else if (engine === 'tesseract') {
          // Only load/use the languages the user actually checked - fewer
          // languages means a smaller model download and less ambiguity
          // between similarly-shaped characters across scripts.
          rawLines = await recognizeWithTesseract(ocrInputDataUrl, tesseractLangString, (progress) => {
            ocrStatus.textContent = `正在辨識圖片中的文字與位置…${Math.round(progress * 100)}%`;
          });
        } else {
          ocrStatus.textContent = '正在用 PaddleOCR 辨識圖片中的文字與位置（第一次使用需要下載模型，可能需要幾秒到十幾秒）…';
          rawLines = await recognizeWithPaddleOCR(ocrInputDataUrl, paddleScriptKey);
        }

        if (thisUploadToken !== uploadToken) return; // superseded while OCR was running - discard these stale results silently

        // Box coordinates came back in the upscaled image's pixel space -
        // scale them back down to natural-image pixels before anything
        // downstream (percentage-of-natural-size math, color sampling
        // against the natural-size `ctx` canvas below) touches them.
        if (ocrScale !== 1) {
          rawLines = rawLines.map((l) => ({ ...l, x0: l.x0 / ocrScale, y0: l.y0 / ocrScale, x1: l.x1 / ocrScale, y1: l.y1 / ocrScale }));
        }

        detectedLines = rawLines.filter((l) => l.text.trim()).map((l) => {
          const { x0, y0, x1, y1 } = l;
          const text = l.text.trim();
          const { color, shadow, gradient } = extractTextColor(ctx, x0, y0, x1, y1);
          return {
            text,
            leftPct: (x0 / naturalWidth) * 100,
            topPct: (y0 / naturalHeight) * 100,
            widthPct: ((x1 - x0) / naturalWidth) * 100,
            heightPct: ((y1 - y0) / naturalHeight) * 100,
            // fontSizeCqw/letterSpacing/lineHeight are filled in below, after
            // merging - fitting them per raw OCR line here (before merging)
            // would fit against a box that a merge might immediately replace
            // with a taller/wider union box, wasting the fit and leaving a
            // multi-line merged box using only its first sub-line's numbers.
            fontSizeCqw: 0,
            color,
            shadow,
            // null unless extractTextColor() detected a real horizontal
            // color shift across the line (js/color.js) - rendering paths
            // fall back to the flat `color` above whenever this is null.
            gradient,
            opacity: 1,
            letterSpacing: 0,
            lineHeight: 1.05
          };
        });
        // OCR returns one bounding box per detected text LINE, not per
        // paragraph - consecutive lines that are only a small gap apart
        // (and horizontally aligned) are very likely the same multi-line
        // text block in the source image, so merge them into one editable
        // box instead of leaving them as separate stacked boxes (a single
        // box can end up with many rows - merging chains, see
        // js/line-merge.js).
        detectedLines = mergeCloseLines(detectedLines);

        // Fits font-size + letter-spacing against each (possibly merged)
        // line's *final* box and joined text - see js/text-fit.js for why
        // both are solved together instead of only ever adjusting font-size.
        for (const line of detectedLines) {
          const boxWidthPx = (line.widthPct / 100) * naturalWidth;
          const boxHeightPx = (line.heightPct / 100) * naturalHeight;
          let fit = fitTextToBox(ctx, line.text, boxWidthPx, boxHeightPx, OVERLAY_FONT_STACK, OVERLAY_FONT_WEIGHT);
          if (line.lineCount > 1) {
            // Multi-line merged box: line-height and font-size are
            // circularly related here (see js/text-fit.js), so refit once
            // more using the real line-height derived from the first pass
            // instead of that function's flat internal guess - converges
            // close enough without a full iterative solver.
            const perLineHeightPx = boxHeightPx / line.lineCount;
            const measuredLineHeight = Math.min(3, Math.max(0.8, perLineHeightPx / fit.fontSizePx));
            fit = fitTextToBox(ctx, line.text, boxWidthPx, boxHeightPx, OVERLAY_FONT_STACK, OVERLAY_FONT_WEIGHT, measuredLineHeight);
            line.lineHeight = Math.min(3, Math.max(0.8, perLineHeightPx / fit.fontSizePx));
          }
          line.fontSizeCqw = (fit.fontSizePx / naturalWidth) * 100;
          line.letterSpacing = fit.letterSpacingEm;
          delete line.lineCount;
        }

        renderPreview(previewCanvasWrap, detectedLines);

        if (detectedLines.length) {
          ocrStatus.className = 'done';
          ocrStatus.textContent = `辨識完成，偵測到 ${detectedLines.length} 行文字`;
        } else {
          ocrStatus.className = 'error';
          ocrStatus.textContent = '沒有偵測到文字（可能圖片本身沒有文字，或字體太特殊辨識不出來；按「編輯」仍可以手動新增文字方塊）';
        }
      } catch (err) {
        if (thisUploadToken !== uploadToken) return;
        ocrStatus.className = 'error';
        ocrStatus.textContent = '辨識失敗（可能是網路問題，模型下載不了）：' + err.message;
      }

      if (thisUploadToken !== uploadToken) return;
      generateBtn.disabled = !altInput.value.trim() || !imageDataUrl;
    };
    img.src = imageDataUrl;
  };
  reader.readAsDataURL(file);
});

copyBtn.addEventListener('click', async () => {
  htmlOutput.select();
  // navigator.clipboard.writeText() can legitimately reject (permission
  // denied, insecure/non-HTTPS context, page not focused) - previously
  // unhandled, so a failure here silently did nothing with no feedback.
  try {
    await navigator.clipboard.writeText(htmlOutput.value);
    copiedMsg.textContent = '已複製 ✓';
    copiedMsg.classList.remove('error');
    copiedMsg.style.display = 'inline';
    setTimeout(() => { copiedMsg.style.display = 'none'; }, 2000);
  } catch (err) {
    copiedMsg.textContent = '複製失敗，請手動選取文字後用 Ctrl+C（Mac 為 Cmd+C）複製';
    copiedMsg.classList.add('error');
    copiedMsg.style.display = 'inline';
    setTimeout(() => { copiedMsg.style.display = 'none'; }, 4000);
  }
});
