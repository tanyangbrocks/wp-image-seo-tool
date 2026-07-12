import { rgbToHex, hexToRgb } from './color.js';

const editorDialog = document.getElementById('editorDialog');
const editorImg = document.getElementById('editorImg');
const editorCanvasWrap = document.getElementById('editorCanvasWrap');
const editorPanel = document.getElementById('editorPanel');
const panelFontSize = document.getElementById('panelFontSize');
const panelColor = document.getElementById('panelColor');
const panelOpacity = document.getElementById('panelOpacity');
const deleteLineBtn = document.getElementById('deleteLineBtn');
const addLineBtn = document.getElementById('addLineBtn');
const allTransparentToggle = document.getElementById('allTransparentToggle');
const editorBgOpacity = document.getElementById('editorBgOpacity');
const cancelEditorBtn = document.getElementById('cancelEditorBtn');
const saveEditorBtn = document.getElementById('saveEditorBtn');

// editableLines is a deep copy of detectedLines - all editing happens here,
// nothing touches the real data until saveEditor() writes it back. This is
// what lets "cancel" discard every change with zero cleanup.
let editableLines = [];
let selectedIndex = null;
let onSaveCallback = null;
let dragState = null;

function renderCanvas() {
  editorCanvasWrap.querySelectorAll('.editorLineWrap').forEach((el) => el.remove());

  editableLines.forEach((line, index) => {
    const wrap = document.createElement('div');
    wrap.className = 'editorLineWrap' + (index === selectedIndex ? ' selected' : '');
    wrap.dataset.index = String(index);
    wrap.style.left = line.leftPct + '%';
    wrap.style.top = line.topPct + '%';
    if (line.widthPct != null && line.heightPct != null) {
      wrap.style.width = line.widthPct + '%';
      wrap.style.height = line.heightPct + '%';
    } else {
      wrap.classList.add('autoSize');
    }

    const textEl = document.createElement('div');
    textEl.className = 'editorLineText';
    textEl.contentEditable = 'true';
    textEl.textContent = line.text;
    textEl.style.fontSize = line.fontSizeCqw + 'cqw';
    textEl.style.color = line.color;
    textEl.style.textShadow = line.shadow;
    textEl.style.opacity = String(line.opacity);
    // Keeps editableLines in sync with the contenteditable box as the user
    // types, so saveEditor() doesn't need a separate "read back all the
    // text" pass over the DOM.
    textEl.addEventListener('input', () => {
      editableLines[index].text = textEl.textContent;
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'lineDeleteBtn';
    delBtn.textContent = '×';
    delBtn.title = '刪除這個文字方塊';

    wrap.appendChild(textEl);
    wrap.appendChild(delBtn);
    editorCanvasWrap.appendChild(wrap);
  });
}

function selectLine(index) {
  selectedIndex = index;
  editorCanvasWrap.querySelectorAll('.editorLineWrap.selected').forEach((el) => el.classList.remove('selected'));
  const wrap = editorCanvasWrap.querySelector(`.editorLineWrap[data-index="${index}"]`);
  if (wrap) wrap.classList.add('selected');

  const line = editableLines[index];
  panelFontSize.value = line.fontSizeCqw;
  panelColor.value = rgbToHex(line.color);
  panelOpacity.value = Math.round(line.opacity * 100);
  editorPanel.style.display = 'block';
}

function hidePanel() {
  selectedIndex = null;
  editorPanel.style.display = 'none';
}

function deleteLine(index) {
  editableLines.splice(index, 1);
  // The inline "×" badge can delete a box other than the currently selected
  // one - shift selectedIndex to keep pointing at the same underlying line
  // rather than whatever now occupies its old array slot.
  if (selectedIndex === index) {
    hidePanel();
  } else if (selectedIndex != null && selectedIndex > index) {
    selectedIndex -= 1;
  }
  renderCanvas();
}

function updateSelectedBoxStyle() {
  if (selectedIndex == null) return;
  const wrap = editorCanvasWrap.querySelector(`.editorLineWrap[data-index="${selectedIndex}"]`);
  if (!wrap) return;
  const textEl = wrap.querySelector('.editorLineText');
  const line = editableLines[selectedIndex];
  textEl.style.fontSize = line.fontSizeCqw + 'cqw';
  textEl.style.color = line.color;
  textEl.style.opacity = String(line.opacity);
}

// Click-to-select + pointer-drag-to-move share the same delegated listener
// on the canvas so re-rendering the list (add/delete) never leaves stale
// per-box listeners behind.
editorCanvasWrap.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.lineDeleteBtn')) return;
  const wrap = e.target.closest('.editorLineWrap');
  if (!wrap) return;

  const index = Number(wrap.dataset.index);
  selectLine(index);

  const rect = editorCanvasWrap.getBoundingClientRect();
  dragState = {
    index,
    wrap,
    pointerId: e.pointerId,
    startClientX: e.clientX,
    startClientY: e.clientY,
    startLeftPct: editableLines[index].leftPct,
    startTopPct: editableLines[index].topPct,
    canvasWidth: rect.width,
    canvasHeight: rect.height,
    dragging: false
  };
});

editorCanvasWrap.addEventListener('pointermove', (e) => {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const dx = e.clientX - dragState.startClientX;
  const dy = e.clientY - dragState.startClientY;

  // A small movement threshold before treating this as a drag (rather than
  // a click) keeps plain clicks - placing a text caret, pressing the delete
  // badge - from being interpreted as a zero-distance move.
  if (!dragState.dragging && Math.hypot(dx, dy) < 5) return;
  if (!dragState.dragging) {
    dragState.dragging = true;
    dragState.wrap.setPointerCapture(dragState.pointerId);
    // Disable contenteditable while dragging so the browser's text-selection
    // drag doesn't fight with the position drag.
    dragState.wrap.querySelector('.editorLineText').contentEditable = 'false';
  }
  e.preventDefault();

  const newLeft = dragState.startLeftPct + (dx / dragState.canvasWidth) * 100;
  const newTop = dragState.startTopPct + (dy / dragState.canvasHeight) * 100;
  editableLines[dragState.index].leftPct = newLeft;
  editableLines[dragState.index].topPct = newTop;
  dragState.wrap.style.left = newLeft + '%';
  dragState.wrap.style.top = newTop + '%';
});

window.addEventListener('pointerup', (e) => {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  if (dragState.dragging) {
    dragState.wrap.querySelector('.editorLineText').contentEditable = 'true';
  }
  dragState = null;
});

editorCanvasWrap.addEventListener('click', (e) => {
  const delBtn = e.target.closest('.lineDeleteBtn');
  if (!delBtn) return;
  const wrap = delBtn.closest('.editorLineWrap');
  deleteLine(Number(wrap.dataset.index));
});

panelFontSize.addEventListener('input', () => {
  if (selectedIndex == null) return;
  editableLines[selectedIndex].fontSizeCqw = parseFloat(panelFontSize.value);
  updateSelectedBoxStyle();
});
panelColor.addEventListener('input', () => {
  if (selectedIndex == null) return;
  editableLines[selectedIndex].color = hexToRgb(panelColor.value);
  updateSelectedBoxStyle();
});
panelOpacity.addEventListener('input', () => {
  if (selectedIndex == null) return;
  editableLines[selectedIndex].opacity = Number(panelOpacity.value) / 100;
  updateSelectedBoxStyle();
});
deleteLineBtn.addEventListener('click', () => {
  if (selectedIndex == null) return;
  deleteLine(selectedIndex);
});

addLineBtn.addEventListener('click', () => {
  editableLines.push({
    text: '新文字',
    leftPct: 40,
    topPct: 40,
    // No OCR bounding box to inherit - sizes to its own content instead
    // (see docs/plan-manual-overlay-editor.md "先維持自動").
    widthPct: null,
    heightPct: null,
    fontSizeCqw: 4,
    color: 'rgb(255, 255, 255)',
    shadow: '0 1px 3px rgba(0,0,0,0.55)',
    opacity: 1
  });
  const index = editableLines.length - 1;
  renderCanvas();
  selectLine(index);

  const wrap = editorCanvasWrap.querySelector(`.editorLineWrap[data-index="${index}"]`);
  const textEl = wrap.querySelector('.editorLineText');
  textEl.focus();
  const range = document.createRange();
  range.selectNodeContents(textEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});

editorBgOpacity.addEventListener('input', () => {
  editorImg.style.opacity = String(Number(editorBgOpacity.value) / 100);
});

cancelEditorBtn.addEventListener('click', () => {
  editorDialog.close();
});

saveEditorBtn.addEventListener('click', () => {
  // "全部文字改透明" is a batch action applied only at save time - each
  // line's own opacity value in editableLines is left untouched, so
  // unchecking the toggle later (before saving again) restores each box's
  // individually-set opacity rather than some shared value.
  const finalLines = editableLines.map((line) => ({
    ...line,
    opacity: allTransparentToggle.checked ? 0 : line.opacity
  }));
  editorDialog.close();
  if (onSaveCallback) onSaveCallback(finalLines);
});

export function openEditor(detectedLines, imageDataUrl, onSave) {
  editableLines = detectedLines.map((line) => ({ ...line, opacity: line.opacity ?? 1 }));
  onSaveCallback = onSave;
  selectedIndex = null;
  allTransparentToggle.checked = false;
  editorBgOpacity.value = 100;
  editorImg.style.opacity = 1;
  editorImg.src = imageDataUrl;

  renderCanvas();
  hidePanel();
  editorDialog.showModal();
}
