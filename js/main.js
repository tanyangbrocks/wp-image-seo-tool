import { LANGUAGES, PADDLE_SCRIPTS, PADDLE_DEFAULT_SCRIPT } from './languages.js';
import { extractTextColor } from './color.js';
import { recognizeWithGoogleVision } from './ocr-vision.js';
import { recognizeWithTesseract } from './ocr-tesseract.js';
import { recognizeWithPaddleOCR } from './ocr-paddle.js';
import { buildFinalHtml } from './html-builder.js';
import { renderPreview } from './preview.js';
import { openEditor } from './editor.js';

const imageInput = document.getElementById('imageInput');
const ocrStatus = document.getElementById('ocrStatus');
const previewWrap = document.getElementById('previewWrap');
const previewImg = document.getElementById('previewImg');
const altPanel = document.getElementById('altPanel');
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
const wpPreviewWrap = document.getElementById('wpPreviewWrap');
const wpPreviewFrame = document.getElementById('wpPreviewFrame');
const previewBgOpacity = document.getElementById('previewBgOpacity');
const previewOverlayOpacity = document.getElementById('previewOverlayOpacity');
const manualEditBtn = document.getElementById('manualEditBtn');

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

let imageDataUrl = null;
let naturalWidth = 0;
let naturalHeight = 0;
let detectedLines = []; // { text, leftPct, topPct, widthPct, heightPct, fontSizeCqw, color, shadow }

function generateAndPreview() {
  const alt = altInput.value.trim();
  if (!alt) return;

  const html = buildFinalHtml(imageDataUrl, alt, detectedLines);
  htmlOutput.value = html;
  outputWrap.style.display = 'block';

  // Renders the *actual* generated HTML string in an isolated document
  // (srcdoc), not the app's own live overlay state - this is what WordPress
  // would really produce from pasting that HTML, catching any bugs in
  // buildFinalHtml() itself (e.g. escaping) that the live preview wouldn't.
  wpPreviewFrame.srcdoc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:0;font-family:-apple-system,"Microsoft JhengHei","PingFang TC",sans-serif;}</style></head><body>${html}</body></html>`;
  wpPreviewWrap.style.display = 'block';
}

altInput.addEventListener('input', () => {
  generateBtn.disabled = !altInput.value.trim();
});

generateBtn.addEventListener('click', generateAndPreview);

// The two preview-only opacity sliders operate directly on the iframe's
// rendered DOM, not on htmlOutput/detectedLines - each srcdoc write creates
// a brand new document, so both the base-opacity cache and the dblclick
// listener below must be re-attached on every 'load', which also resets the
// sliders to 100% as required ("重新按產生 HTML 時拉桿重置回 100%").
wpPreviewFrame.addEventListener('load', () => {
  const doc = wpPreviewFrame.contentDocument;
  if (!doc) return;

  previewBgOpacity.value = 100;
  previewOverlayOpacity.value = 100;
  doc.querySelectorAll('.ovText').forEach((el) => {
    el.dataset.baseOpacity = el.style.opacity || '1';
  });

  doc.addEventListener('dblclick', () => {
    openEditor(detectedLines, imageDataUrl, handleEditorSave);
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
  // manual editor) stay visible while "peeking" through the overlay.
  const factor = Number(previewOverlayOpacity.value) / 100;
  doc.querySelectorAll('.ovText').forEach((el) => {
    el.style.opacity = String(Number(el.dataset.baseOpacity ?? '1') * factor);
  });
});

function handleEditorSave(newLines) {
  detectedLines = newLines;
  renderPreview(previewWrap, detectedLines);
  generateAndPreview();
}

manualEditBtn.addEventListener('click', () => {
  openEditor(detectedLines, imageDataUrl, handleEditorSave);
});

imageInput.addEventListener('change', async () => {
  const file = imageInput.files[0];
  if (!file) return;

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

  const reader = new FileReader();
  reader.onload = async (e) => {
    imageDataUrl = e.target.result;
    detectedLines = [];
    altInput.value = '';
    generateBtn.disabled = true;
    altPanel.style.display = 'none';
    outputWrap.style.display = 'none';
    wpPreviewWrap.style.display = 'none';
    previewWrap.style.display = 'none';

    ocrStatus.className = '';
    ocrStatus.style.display = 'block';
    ocrStatus.textContent = '載入圖片中…';

    const img = new Image();
    img.onload = async () => {
      naturalWidth = img.naturalWidth;
      naturalHeight = img.naturalHeight;

      // Offscreen canvas for sampling the real text color behind each detected line.
      const canvas = document.createElement('canvas');
      canvas.width = naturalWidth;
      canvas.height = naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      previewImg.src = imageDataUrl;
      previewWrap.style.display = 'block';

      ocrStatus.textContent = '正在辨識圖片中的文字與位置…';
      try {
        let rawLines = null;

        const tesseractLangString = selectedLanguages.map((l) => l.tesseract).join('+');
        const visionLangHints = selectedLanguages.map((l) => l.vision);
        const paddleScriptKey = paddleScriptSelect.value;

        if (engine === 'vision') {
          try {
            ocrStatus.textContent = '正在用 Google Cloud Vision 辨識圖片中的文字與位置…';
            rawLines = await recognizeWithGoogleVision(imageDataUrl, apiKeyInput.value.trim(), visionLangHints);
          } catch (cloudErr) {
            // Fall back to PaddleOCR (the default engine) rather than
            // dead-ending the whole flow on a bad/expired key or network hiccup.
            ocrStatus.textContent = `Google Cloud Vision 辨識失敗（${cloudErr.message}），改用 PaddleOCR…`;
            rawLines = await recognizeWithPaddleOCR(imageDataUrl, PADDLE_DEFAULT_SCRIPT);
          }
        } else if (engine === 'tesseract') {
          // Only load/use the languages the user actually checked - fewer
          // languages means a smaller model download and less ambiguity
          // between similarly-shaped characters across scripts.
          rawLines = await recognizeWithTesseract(imageDataUrl, tesseractLangString, (progress) => {
            ocrStatus.textContent = `正在辨識圖片中的文字與位置…${Math.round(progress * 100)}%`;
          });
        } else {
          ocrStatus.textContent = '正在用 PaddleOCR 辨識圖片中的文字與位置（第一次使用需要下載模型，可能需要幾秒到十幾秒）…';
          rawLines = await recognizeWithPaddleOCR(imageDataUrl, paddleScriptKey);
        }

        detectedLines = rawLines.filter((l) => l.text.trim()).map((l) => {
          const { x0, y0, x1, y1 } = l;
          const { color, shadow } = extractTextColor(ctx, x0, y0, x1, y1);
          return {
            text: l.text.trim(),
            leftPct: (x0 / naturalWidth) * 100,
            topPct: (y0 / naturalHeight) * 100,
            widthPct: ((x1 - x0) / naturalWidth) * 100,
            heightPct: ((y1 - y0) / naturalHeight) * 100,
            // Font size as a % of image WIDTH (cqw): since the image scales
            // uniformly (width:100%; height:auto), a size expressed this way
            // stays proportional to the original bounding box at any render size.
            fontSizeCqw: ((y1 - y0) / naturalWidth) * 100 * 0.85,
            color,
            shadow
          };
        });

        renderPreview(previewWrap, detectedLines);

        if (detectedLines.length) {
          ocrStatus.className = 'done';
          ocrStatus.textContent = `辨識完成，偵測到 ${detectedLines.length} 行文字並已還原到對應位置`;
        } else {
          ocrStatus.className = 'error';
          ocrStatus.textContent = '沒有偵測到文字（可能圖片本身沒有文字，或字體太特殊辨識不出來）';
        }
      } catch (err) {
        ocrStatus.className = 'error';
        ocrStatus.textContent = '辨識失敗（可能是網路問題，模型下載不了）：' + err.message;
      }

      altPanel.style.display = 'block';
    };
    img.src = imageDataUrl;
  };
  reader.readAsDataURL(file);
});

copyBtn.addEventListener('click', async () => {
  htmlOutput.select();
  await navigator.clipboard.writeText(htmlOutput.value);
  copiedMsg.style.display = 'inline';
  setTimeout(() => { copiedMsg.style.display = 'none'; }, 2000);
});
