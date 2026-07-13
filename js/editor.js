import { rgbToHex, hexToRgb, applyTextFillStyle } from './color.js';

const editorImg = document.getElementById('editorImg');
const editorCanvasWrap = document.getElementById('editorCanvasWrap');
const editorPanel = document.getElementById('editorPanel');
const panelFontSize = document.getElementById('panelFontSize');
const panelColor = document.getElementById('panelColor');
const panelOpacity = document.getElementById('panelOpacity');
const panelLetterSpacing = document.getElementById('panelLetterSpacing');
const panelLineHeight = document.getElementById('panelLineHeight');
const deleteLineBtn = document.getElementById('deleteLineBtn');
const addLineBtn = document.getElementById('addLineBtn');
const allTransparentToggle = document.getElementById('allTransparentToggle');
const editorBgOpacity = document.getElementById('editorBgOpacity');

// Edits here are immediate and permanent - this module operates directly on
// the same array reference main.js owns (mutated in place with push/splice/
// property assignment, never reassigned), so there's no separate "save" step
// and nothing to reconcile back. main.js just reads this array's current
// contents whenever it builds the output HTML.
let detectedLines = [];
let selectedIndex = null;
let dragState = null;

function renderCanvas() {
  editorCanvasWrap.querySelectorAll('.ovBox').forEach((el) => el.remove());

  detectedLines.forEach((line, index) => {
    const box = document.createElement('div');
    box.className = 'ovBox' + (index === selectedIndex ? ' selected' : '');
    box.dataset.index = String(index);
    box.style.left = line.leftPct + '%';
    box.style.top = line.topPct + '%';
    box.style.width = line.widthPct + '%';
    box.style.height = line.heightPct + '%';

    const textEl = document.createElement('div');
    textEl.className = 'ovBoxText';
    textEl.contentEditable = 'true';
    textEl.textContent = line.text;
    textEl.style.fontSize = line.fontSizeCqw + 'cqw';
    applyTextFillStyle(textEl, line);
    textEl.style.textShadow = line.shadow;
    textEl.style.opacity = String(line.opacity ?? 1);
    textEl.style.letterSpacing = (line.letterSpacing ?? 0) + 'em';
    textEl.style.lineHeight = String(line.lineHeight ?? 1.05);
    // contenteditable inserts literal newlines as <br> or new <div>s rather
    // than reflecting back into textContent as "\n" characters the way a
    // <textarea> would - white-space:pre-line (see CSS) still displays a
    // merged multi-line box's existing "\n"s correctly, this just keeps
    // manual Enter-key edits inside a box from producing DOM the .textContent
    // readback below wouldn't round-trip cleanly (contenteditable + pre-line
    // is an intentionally text-only editing surface, not a rich editor).
    textEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });
    // Keeps detectedLines in sync with the contenteditable box as the user
    // types. textEl is never toggled non-editable and never intercepted by
    // drag logic (drag only starts from the separate .ovMoveHandle/
    // .ovResizeHandle elements below) - clicking text always just edits it.
    textEl.addEventListener('input', () => {
      line.text = textEl.textContent;
    });
    textEl.addEventListener('focus', () => selectLine(index));

    const moveHandle = document.createElement('button');
    moveHandle.type = 'button';
    moveHandle.className = 'ovMoveHandle';
    moveHandle.title = '拖曳移動位置（取得焦點後也可以用方向鍵微調，Shift+方向鍵幅度較大）';
    moveHandle.setAttribute('aria-label', '拖曳移動位置');
    moveHandle.textContent = '✛';

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'ovDeleteBtn';
    delBtn.title = '刪除這個文字方塊';
    delBtn.setAttribute('aria-label', '刪除這個文字方塊');
    delBtn.textContent = '×';

    box.appendChild(textEl);
    box.appendChild(moveHandle);
    box.appendChild(delBtn);
    for (const corner of ['nw', 'ne', 'sw', 'se']) {
      const handle = document.createElement('div');
      handle.className = 'ovResizeHandle ' + corner;
      handle.dataset.corner = corner;
      box.appendChild(handle);
    }

    editorCanvasWrap.appendChild(box);
  });
}

function selectLine(index) {
  selectedIndex = index;
  editorCanvasWrap.querySelectorAll('.ovBox.selected').forEach((el) => el.classList.remove('selected'));
  const box = editorCanvasWrap.querySelector(`.ovBox[data-index="${index}"]`);
  if (box) box.classList.add('selected');

  const line = detectedLines[index];
  panelFontSize.value = line.fontSizeCqw;
  panelColor.value = rgbToHex(line.color);
  panelOpacity.value = Math.round((line.opacity ?? 1) * 100);
  panelLetterSpacing.value = line.letterSpacing ?? 0;
  panelLineHeight.value = line.lineHeight ?? 1.05;
  editorPanel.style.display = 'block';
}

function hidePanel() {
  selectedIndex = null;
  editorPanel.style.display = 'none';
}

function deleteLine(index) {
  detectedLines.splice(index, 1);
  // The inline "×" badge can delete a box other than the currently selected
  // one - shift selectedIndex to keep pointing at the same underlying line
  // rather than whatever now occupies its old array slot.
  if (selectedIndex === index) {
    hidePanel();
  } else if (selectedIndex != null && selectedIndex > index) {
    selectedIndex -= 1;
  }
  renderCanvas();
  // Whatever had focus (the delete badge itself, or the panel's delete
  // button just before hidePanel() hid its container) was just removed from
  // the DOM - browsers drop focus to <body> in that case with no visual
  // indication of where it went. editorCanvasWrap is always present and has
  // tabindex="-1" (index.html) specifically so it's a valid, stable landing
  // spot for keyboard users instead of losing focus entirely.
  editorCanvasWrap.focus();
}

const MIN_BOX_PCT = 2;

// Keeps a box's rectangle fully inside the 0-100% canvas bounds. Resize
// already clamped width/height at their lower end but nothing clamped
// leftPct/topPct, so a move (or a resize whose anchor corner drags past an
// edge) could push a box out from under #editorCanvasWrap's overflow:hidden
// with no way to get it back - there's no numeric position field, only the
// handles, and a box you can't see has no handles to grab.
function clampLine(line) {
  line.widthPct = Math.min(Math.max(MIN_BOX_PCT, line.widthPct), 100);
  line.heightPct = Math.min(Math.max(MIN_BOX_PCT, line.heightPct), 100);
  line.leftPct = Math.min(Math.max(0, line.leftPct), 100 - line.widthPct);
  line.topPct = Math.min(Math.max(0, line.topPct), 100 - line.heightPct);
}

function updateBoxGeometry(index) {
  const box = editorCanvasWrap.querySelector(`.ovBox[data-index="${index}"]`);
  if (!box) return;
  const line = detectedLines[index];
  box.style.left = line.leftPct + '%';
  box.style.top = line.topPct + '%';
  box.style.width = line.widthPct + '%';
  box.style.height = line.heightPct + '%';
}

function updateSelectedBoxStyle() {
  if (selectedIndex == null) return;
  const box = editorCanvasWrap.querySelector(`.ovBox[data-index="${selectedIndex}"]`);
  if (!box) return;
  const textEl = box.querySelector('.ovBoxText');
  const line = detectedLines[selectedIndex];
  textEl.style.fontSize = line.fontSizeCqw + 'cqw';
  applyTextFillStyle(textEl, line);
  textEl.style.opacity = String(line.opacity ?? 1);
  textEl.style.letterSpacing = (line.letterSpacing ?? 0) + 'em';
  textEl.style.lineHeight = String(line.lineHeight ?? 1.05);
}

// Move/resize both start only from their dedicated handle elements (never
// from the text itself), so there's no ambiguity between "click to place a
// caret" and "drag to move/resize" - see docs/plan history for the bug this
// structural separation replaced (a movement-threshold heuristic that
// intermittently ate clicks and could leave a box stuck to the pointer).
editorCanvasWrap.addEventListener('pointerdown', (e) => {
  const moveHandle = e.target.closest('.ovMoveHandle');
  const resizeHandle = e.target.closest('.ovResizeHandle');
  if (!moveHandle && !resizeHandle) return;

  const box = (moveHandle || resizeHandle).closest('.ovBox');
  const index = Number(box.dataset.index);
  selectLine(index);
  e.preventDefault();

  const rect = editorCanvasWrap.getBoundingClientRect();
  const line = detectedLines[index];
  const handle = moveHandle || resizeHandle;
  // setPointerCapture keeps this handle receiving pointermove/up even if the
  // cursor moves outside it mid-drag - a nice-to-have, not a requirement,
  // since pointermove is also handled via delegation on editorCanvasWrap.
  // It can throw InvalidPointerId if the browser doesn't consider this
  // pointerId "active" (observed with synthetic PointerEvents in testing;
  // exotic real input could plausibly hit the same path) - letting that
  // exception escape would abort this handler *before* dragState gets set,
  // silently turning every subsequent pointermove into a no-op for the rest
  // of the drag. Capture is strictly an enhancement, so a failure here must
  // not block dragState from being set up.
  try {
    handle.setPointerCapture(e.pointerId);
  } catch (err) {
    /* not fatal - see comment above */
  }

  dragState = {
    type: moveHandle ? 'move' : 'resize',
    corner: resizeHandle ? resizeHandle.dataset.corner : null,
    index,
    pointerId: e.pointerId,
    startClientX: e.clientX,
    startClientY: e.clientY,
    startLeftPct: line.leftPct,
    startTopPct: line.topPct,
    startWidthPct: line.widthPct,
    startHeightPct: line.heightPct,
    canvasWidth: rect.width,
    canvasHeight: rect.height
  };
});

editorCanvasWrap.addEventListener('pointermove', (e) => {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  // Self-heals a stuck drag if a pointerup/pointercancel was ever missed
  // (e.g. the button was released outside the window).
  if (e.buttons === 0) { dragState = null; return; }
  e.preventDefault();

  const dxPct = ((e.clientX - dragState.startClientX) / dragState.canvasWidth) * 100;
  const dyPct = ((e.clientY - dragState.startClientY) / dragState.canvasHeight) * 100;
  const line = detectedLines[dragState.index];

  if (dragState.type === 'move') {
    line.leftPct = dragState.startLeftPct + dxPct;
    line.topPct = dragState.startTopPct + dyPct;
  } else {
    const { startLeftPct: L, startTopPct: T, startWidthPct: W, startHeightPct: H, corner } = dragState;
    if (corner === 'se') {
      line.widthPct = Math.max(MIN_BOX_PCT, W + dxPct);
      line.heightPct = Math.max(MIN_BOX_PCT, H + dyPct);
    } else if (corner === 'sw') {
      const newW = Math.max(MIN_BOX_PCT, W - dxPct);
      line.leftPct = L + (W - newW);
      line.widthPct = newW;
      line.heightPct = Math.max(MIN_BOX_PCT, H + dyPct);
    } else if (corner === 'ne') {
      line.widthPct = Math.max(MIN_BOX_PCT, W + dxPct);
      const newH = Math.max(MIN_BOX_PCT, H - dyPct);
      line.topPct = T + (H - newH);
      line.heightPct = newH;
    } else {
      const newW = Math.max(MIN_BOX_PCT, W - dxPct);
      const newH = Math.max(MIN_BOX_PCT, H - dyPct);
      line.leftPct = L + (W - newW);
      line.topPct = T + (H - newH);
      line.widthPct = newW;
      line.heightPct = newH;
    }
  }
  clampLine(line);
  updateBoxGeometry(dragState.index);
});

function endDrag(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  dragState = null;
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

// Keyboard-only equivalent for moving a box: the move handle is a real
// <button>, reachable by Tab, but arrow keys previously did nothing once it
// had focus - pointer drag was the only way to reposition anything.
// (Resize doesn't get a keyboard path here - four directions to disambiguate
// makes the interaction meaningfully more complex, and move already covers
// the core "get it un-stuck" need.)
const ARROW_DELTAS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
editorCanvasWrap.addEventListener('keydown', (e) => {
  const moveHandle = e.target.closest && e.target.closest('.ovMoveHandle');
  if (!moveHandle) return;
  const delta = ARROW_DELTAS[e.key];
  if (!delta) return;
  e.preventDefault();

  const box = moveHandle.closest('.ovBox');
  const index = Number(box.dataset.index);
  const line = detectedLines[index];
  const step = e.shiftKey ? 2 : 0.5;
  line.leftPct += delta[0] * step;
  line.topPct += delta[1] * step;
  clampLine(line);
  updateBoxGeometry(index);
});

editorCanvasWrap.addEventListener('click', (e) => {
  const delBtn = e.target.closest('.ovDeleteBtn');
  if (!delBtn) return;
  const box = delBtn.closest('.ovBox');
  deleteLine(Number(box.dataset.index));
});

panelFontSize.addEventListener('input', () => {
  if (selectedIndex == null) return;
  detectedLines[selectedIndex].fontSizeCqw = parseFloat(panelFontSize.value);
  updateSelectedBoxStyle();
});
panelColor.addEventListener('input', () => {
  if (selectedIndex == null) return;
  detectedLines[selectedIndex].color = hexToRgb(panelColor.value);
  // A manual color pick is an explicit override - if this line had an
  // auto-detected gradient fill (js/color.js), it should stop taking
  // priority over the flat color the user just chose.
  detectedLines[selectedIndex].gradient = null;
  updateSelectedBoxStyle();
});
panelOpacity.addEventListener('input', () => {
  if (selectedIndex == null) return;
  detectedLines[selectedIndex].opacity = Number(panelOpacity.value) / 100;
  updateSelectedBoxStyle();
});
panelLetterSpacing.addEventListener('input', () => {
  if (selectedIndex == null) return;
  detectedLines[selectedIndex].letterSpacing = Number(panelLetterSpacing.value);
  updateSelectedBoxStyle();
});
panelLineHeight.addEventListener('input', () => {
  if (selectedIndex == null) return;
  detectedLines[selectedIndex].lineHeight = Number(panelLineHeight.value);
  updateSelectedBoxStyle();
});
deleteLineBtn.addEventListener('click', () => {
  if (selectedIndex == null) return;
  deleteLine(selectedIndex);
});

addLineBtn.addEventListener('click', () => {
  // No OCR bounding box to inherit - starts as a reasonable default
  // rectangle the user can immediately drag/resize into place with the
  // same handles as any other box (manual resize now always available,
  // superseding the old OCR-box-only sizing model).
  detectedLines.push({
    text: '新文字',
    leftPct: 38,
    topPct: 38,
    widthPct: 24,
    heightPct: 8,
    fontSizeCqw: 4,
    color: 'rgb(255, 255, 255)',
    shadow: '0 1px 3px rgba(0,0,0,0.55)',
    opacity: 1,
    letterSpacing: 0,
    lineHeight: 1.05
  });
  const index = detectedLines.length - 1;
  renderCanvas();
  selectLine(index);

  const box = editorCanvasWrap.querySelector(`.ovBox[data-index="${index}"]`);
  const textEl = box.querySelector('.ovBoxText');
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

// Live batch toggle (no save/cancel to hide behind): checking it stashes
// each line's current opacity in _prevOpacity and zeroes it out immediately;
// unchecking restores each line's own stashed value, not a shared one.
allTransparentToggle.addEventListener('change', () => {
  if (allTransparentToggle.checked) {
    detectedLines.forEach((line) => {
      line._prevOpacity = line.opacity ?? 1;
      line.opacity = 0;
    });
  } else {
    detectedLines.forEach((line) => {
      if (line._prevOpacity != null) {
        line.opacity = line._prevOpacity;
        delete line._prevOpacity;
      }
    });
  }
  renderCanvas();
  if (selectedIndex != null) selectLine(selectedIndex);
});

// Called once per successful OCR run (and whenever the user re-uploads),
// mounting the live editing canvas directly against the same detectedLines
// array main.js will later serialize into the output HTML.
export function mountEditor(lines, imageDataUrl) {
  detectedLines = lines;
  selectedIndex = null;
  allTransparentToggle.checked = false;
  editorBgOpacity.value = 100;
  editorImg.style.opacity = 1;
  editorImg.src = imageDataUrl;

  renderCanvas();
  hidePanel();
}
