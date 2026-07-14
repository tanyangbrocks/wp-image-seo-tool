import { LANGUAGES, PADDLE_SCRIPTS, PADDLE_DEFAULT_SCRIPT } from './languages.js';

// Everything to do with the "調整辨識語言與引擎" settings popover: building
// its dynamic option lists, opening/closing it, remembering the user's
// Vision API key, and exposing getters for whatever main.js's upload flow
// needs to read out of it. Self-initializes on import, same as every other
// module here - no explicit init() call needed.
const apiKeyInput = document.getElementById('apiKeyInput');
const rememberKey = document.getElementById('rememberKey');
const languageList = document.getElementById('languageList');
const languageListPanel = document.getElementById('languageListPanel');
const visionKeyPanel = document.getElementById('visionKeyPanel');
const paddleScriptPanel = document.getElementById('paddleScriptPanel');
const paddleScriptSelect = document.getElementById('paddleScriptSelect');
const engineRadios = document.getElementsByName('engineChoice');
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

export function getSelectedLanguages() {
  return LANGUAGES.filter((lang) => document.getElementById('lang_' + lang.tesseract).checked);
}

export function getSelectedEngine() {
  for (const radio of engineRadios) if (radio.checked) return radio.value;
  return 'paddle';
}

export function getPaddleScriptKey() {
  return paddleScriptSelect.value;
}

export function getApiKey() {
  return apiKeyInput.value.trim();
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

// localStorage can throw (not just return null/no-op) in real browsers -
// Safari in private browsing mode throws on every write, some browsers
// throw if the user has disabled storage entirely, and any implementation
// can throw QuotaExceededError. "Remember this key" is a convenience, not
// core functionality (the tool works fine re-pasting the key each visit),
// so a storage failure should degrade silently rather than break the
// settings panel's other event handlers.
function readSavedKey() {
  try {
    return localStorage.getItem('wpOverlayGen_visionApiKey');
  } catch {
    return null;
  }
}
function writeSavedKey(value) {
  try {
    if (value) localStorage.setItem('wpOverlayGen_visionApiKey', value);
    else localStorage.removeItem('wpOverlayGen_visionApiKey');
  } catch {
    /* storage unavailable - the key just won't persist across visits */
  }
}

// Restore a remembered key (only ever written to *this browser's* local
// storage by the checkbox below - never embedded in the shared HTML file
// or sent anywhere except directly to Google's API from this page).
const savedKey = readSavedKey();
if (savedKey) {
  apiKeyInput.value = savedKey;
  rememberKey.checked = true;
  document.getElementById('engine_vision').checked = true;
  updateEnginePanels();
}
rememberKey.addEventListener('change', () => {
  writeSavedKey(rememberKey.checked && apiKeyInput.value.trim() ? apiKeyInput.value.trim() : null);
});
apiKeyInput.addEventListener('input', () => {
  if (rememberKey.checked) writeSavedKey(apiKeyInput.value.trim());
});
