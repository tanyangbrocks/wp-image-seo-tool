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
