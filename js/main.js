import { LANGUAGES, PADDLE_SCRIPTS, PADDLE_DEFAULT_SCRIPT } from './languages.js';
import { extractTextColor } from './color.js';
import { recognizeWithGoogleVision } from './ocr-vision.js';
import { recognizeWithTesseract } from './ocr-tesseract.js';
import { recognizeWithPaddleOCR, preloadDefaultModel } from './ocr-paddle.js';
import { prepareImageForOcr } from './image-prep.js';
import { mergeCloseLines } from './line-merge.js';
import { fitTextToBox, OVERLAY_FONT_STACK, OVERLAY_FONT_WEIGHT } from './text-fit.js';
import { buildFinalHtml } from './html-builder.js';
import { renderPreview } from './preview.js';
import { mountEditor } from './editor.js';

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
const previewWrap = document.getElementById('previewWrap');
const previewImg = document.getElementById('previewImg');
const previewCanvasWrap = document.getElementById('previewCanvasWrap');
const previewCanvasImg = document.getElementById('previewCanvasImg');
const openEditorBtn = document.getElementById('openEditorBtn');
const previewOpacityControls = document.getElementById('previewOpacityControls');
const previewCanvasBgOpacity = document.getElementById('previewCanvasBgOpacity');
const editorDialog = document.getElementById('editorDialog');
const closeEditorBtn = document.getElementById('closeEditorBtn');
const altInput = document.getElementById('altInput');
const generateBtn = document.getElementById('generateBtn');
const outputWrap = document.getElementById('outputWrap');
const htmlOutput = document.getElementById('htmlOutput');
const copyBtn = document.getElementById('copyBtn');
const copiedMsg = document.getElementById('copiedMsg');
const apiKeyInput = document.getElementById('apiKeyInput');
const rememberKey = document.getElementById('rememberKey');
const languageList = document.getElementById('languageList');
const languageListPanel = document.getElementById('languageListPanel');
const visionKeyPanel = document.getElementById('visionKeyPanel');
const paddleScriptPanel = document.getElementById('paddleScriptPanel');
const paddleScriptSelect = document.getElementById('paddleScriptSelect');
const engineRadios = document.getElementsByName('engineChoice');
const wpPreviewFrame = document.getElementById('wpPreviewFrame');
const previewBgOpacity = document.getElementById('previewBgOpacity');
const previewOverlayOpacity = document.getElementById('previewOverlayOpacity');
const settingsToggleBtn = document.getElementById('settingsToggleBtn');
const settingsPanel = document.getElementById('settingsPanel');

for (const lang of LANGUAGES) {
  const row = document.createElement('div');
  row.className = 'checkboxRow';
  const id = 'lang_' + lang.tesseract;
  row.innerHTML = `<input type="checkbox" id="${id}" ${lang.defaultOn ? 'checked' : ''} /><label for="${id}" style="margin:0;">${lang.label}</label>`;
  languageList.appendChild(row);
}

for (const script of PADDLE_SCRIPTS) {
  const opt = document.createElement('option');
  opt.value = script.key;
  opt.textContent = script.label;
  paddleScriptSelect.appendChild(opt);
}
paddleScriptSelect.value = PADDLE_DEFAULT_SCRIPT;

function getSelectedLanguages() {
  return LANGUAGES.filter((lang) => document.getElementById('lang_' + lang.tesseract).checked);
}

function getSelectedEngine() {
  for (const radio of engineRadios) if (radio.checked) return radio.value;
  return 'paddle';
}

function updateEnginePanels() {
  const engine = getSelectedEngine();
  paddleScriptPanel.style.display = engine === 'paddle' ? 'block' : 'none';
  languageListPanel.style.display = engine === 'paddle' ? 'none' : 'block';
  visionKeyPanel.style.display = engine === 'vision' ? 'block' : 'none';
}
for (const radio of engineRadios) radio.addEventListener('change', updateEnginePanels);
updateEnginePanels();

// Settings menu is closed by default and opens as a floating panel overlaid
// on top of the page (not an in-flow <details> that pushes content down) -
// closes on outside click or Esc.
function closeSettingsPanel() {
  settingsPanel.hidden = true;
  settingsToggleBtn.setAttribute('aria-expanded', 'false');
}
settingsToggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = settingsPanel.hidden;
  settingsPanel.hidden = !willOpen;
  settingsToggleBtn.setAttribute('aria-expanded', String(willOpen));
});
document.addEventListener('click', (e) => {
  if (settingsPanel.hidden) return;
  if (settingsPanel.contains(e.target) || e.target === settingsToggleBtn) return;
  closeSettingsPanel();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !settingsPanel.hidden) closeSettingsPanel();
});

// Restore a remembered key (only ever written to *this browser's* local
// storage by the checkbox below - never embedded in the shared HTML file
// or sent anywhere except directly to Google's API from this page).
const savedKey = localStorage.getItem('wpOverlayGen_visionApiKey');
if (savedKey) {
  apiKeyInput.value = savedKey;
  rememberKey.checked = true;
  document.getElementById('engine_vision').checked = true;
  updateEnginePanels();
}
rememberKey.addEventListener('change', () => {
  if (rememberKey.checked && apiKeyInput.value.trim()) {
    localStorage.setItem('wpOverlayGen_visionApiKey', apiKeyInput.value.trim());
  } else {
    localStorage.removeItem('wpOverlayGen_visionApiKey');
  }
});
apiKeyInput.addEventListener('input', () => {
  if (rememberKey.checked) localStorage.setItem('wpOverlayGen_visionApiKey', apiKeyInput.value.trim());
});

// Warm up PaddleOCR's model download+init in the background as soon as the
// page loads (after the savedKey check above, so a returning Vision user
// doesn't get this triggered pointlessly) rather than waiting for the first
// upload to pay that cold-start cost. requestIdleCallback lets initial
// render finish first; falls back to a short timeout on browsers that lack it.
if (getSelectedEngine() === 'paddle') {
  // A timeout is required here, not just a nicety: browsers throttle
  // requestIdleCallback hard (sometimes indefinitely) in hidden/background
  // tabs, which would defeat the point of preloading for anyone who opens
  // this page in a background tab.
  const runWhenIdle = window.requestIdleCallback || ((cb) => setTimeout(cb, 200));
  runWhenIdle(() => preloadDefaultModel(), { timeout: 2000 });
}

let imageDataUrl = null;
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

// "← 上一步" - confirms before discarding whatever's currently loaded/being
// processed and scrolling back to the landing screen. Bumping uploadToken
// reuses the same race-guard every async OCR step already checks (see
// imageInput's 'change' handler below), so an in-flight recognition call
// that finishes after the user has already backed out silently discards
// its result instead of clobbering the now-reset UI.
function resetWorkspace() {
  ++uploadToken;
  imageDataUrl = null;
  naturalWidth = 0;
  naturalHeight = 0;
  detectedLines = [];
  imageInput.value = '';
  previewImg.removeAttribute('src');
  previewCanvasImg.removeAttribute('src');
  renderPreview(previewCanvasWrap, []);
  openEditorBtn.hidden = true;
  previewOpacityControls.hidden = true;
  altInput.value = '';
  generateBtn.disabled = true;
  outputWrap.hidden = true;
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

function generateAndPreview() {
  const alt = altInput.value.trim();
  if (!alt || !imageDataUrl) return;

  const html = buildFinalHtml(imageDataUrl, alt, detectedLines, naturalWidth, naturalHeight);
  htmlOutput.value = html;
  outputWrap.hidden = false;

  // Renders the *actual* generated HTML string in an isolated document
  // (srcdoc), not the app's own live overlay state - this is what WordPress
  // would really produce from pasting that HTML, catching any bugs in
  // buildFinalHtml() itself (e.g. escaping) that the live preview wouldn't.
  wpPreviewFrame.srcdoc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:0;font-family:-apple-system,"Microsoft JhengHei","PingFang TC",sans-serif;}</style></head><body>${html}</body></html>`;
}

altInput.addEventListener('input', () => {
  generateBtn.disabled = !altInput.value.trim() || !imageDataUrl;
});

generateBtn.addEventListener('click', generateAndPreview);

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
  if (engine === 'vision' && !apiKeyInput.value.trim()) {
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
    detectedLines = [];
    altInput.value = '';
    generateBtn.disabled = true;
    outputWrap.hidden = true;
    openEditorBtn.hidden = true;
    previewOpacityControls.hidden = true;

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
        const paddleScriptKey = paddleScriptSelect.value;

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
            rawLines = await recognizeWithGoogleVision(ocrInputDataUrl, apiKeyInput.value.trim(), visionLangHints);
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
          ocrStatus.textContent = `辨識完成，偵測到 ${detectedLines.length} 行文字，右邊可以預覽，按「編輯」調整位置/大小`;
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
