// Tesseract language codes + Google Vision's languageHints codes (different
// code systems, so each entry carries both) + display label. Fewer selected
// languages = smaller/faster model download for Tesseract and less
// character-shape ambiguity for both engines, so this defaults to just the
// two most common ones rather than everything.
export const LANGUAGES = [
  { tesseract: 'chi_tra', vision: 'zh-Hant', label: '繁體中文', defaultOn: true },
  { tesseract: 'chi_sim', vision: 'zh-Hans', label: '简体中文', defaultOn: false },
  { tesseract: 'eng', vision: 'en', label: 'English', defaultOn: true },
  { tesseract: 'jpn', vision: 'ja', label: '日本語', defaultOn: false },
  { tesseract: 'kor', vision: 'ko', label: '한국어', defaultOn: false },
  { tesseract: 'rus', vision: 'ru', label: 'Русский', defaultOn: false },
  { tesseract: 'deu', vision: 'de', label: 'Deutsch', defaultOn: false },
  { tesseract: 'fra', vision: 'fr', label: 'Français', defaultOn: false },
  { tesseract: 'spa', vision: 'es', label: 'Español', defaultOn: false }
];

// PaddleOCR (ppu-paddle-ocr) ships one weight file per script family rather
// than per language - its default model already recognizes Traditional/
// Simplified Chinese, Japanese, English and other Latin-script languages
// (French/German/Spanish/etc.) together, confirmed empirically in
// docs/plan-paddleocr-evaluation.md Phase A (2026-07-12: "Hello 測試 123"
// recognized correctly with zero language config). So unlike Tesseract/
// Google Vision there's no per-language checkbox list - only scripts
// genuinely outside that unified model need a dedicated preset swap.
// `preset` is the export name to pull off the dynamically-imported
// ppu-paddle-ocr module (see js/ocr-paddle.js); null means "use the
// package's default model, don't override".
export const PADDLE_DEFAULT_SCRIPT = 'default';
export const PADDLE_SCRIPTS = [
  { key: 'default', label: 'CJK + 拉丁語系（繁中/簡中/日文/英文/法文/德文/西文等，預設）', preset: null },
  { key: 'korean', label: '한국어 韓文', preset: 'V5_KOREAN_MOBILE_MODEL' },
  { key: 'arabic', label: 'العربية 阿拉伯文', preset: 'V5_ARABIC_MOBILE_MODEL' },
  { key: 'cyrillic', label: 'Кириллица 西里爾字母（俄文等）', preset: 'V5_CYRILLIC_MOBILE_MODEL' },
  { key: 'greek', label: 'Ελληνικά 希臘文', preset: 'V5_GREEK_MOBILE_MODEL' },
  { key: 'thai', label: 'ไทย 泰文', preset: 'V5_THAI_MOBILE_MODEL' },
  { key: 'tamil', label: 'தமிழ் 坦米爾文', preset: 'V5_TAMIL_MOBILE_MODEL' },
  { key: 'telugu', label: 'తెలుగు 泰盧固文', preset: 'V5_TELUGU_MOBILE_MODEL' },
  { key: 'devanagari', label: 'देवनागरी 天城文（印地語等）', preset: 'V5_DEVANAGARI_MOBILE_MODEL' }
];
