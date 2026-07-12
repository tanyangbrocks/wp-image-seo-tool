# WordPress 預覽區手動編輯介面 — 實作計畫

最後更新：2026-07-12

## 一、目標

現在的 WordPress 預覽（`<iframe srcdoc>` 直接渲染 `buildFinalHtml()` 產生的 HTML）是唯讀的——OCR 辨識出什麼位置/顏色/文字，使用者就只能照單全收，頂多重新上傳圖片或改語言重跑一次。這次要加兩層東西：

1. **預覽區旁邊兩個透明度拉桿**（純預覽用，不影響實際產生的 HTML）：一個調底圖透明度，一個調疊字透明度，方便使用者「透視」底圖跟疊字的相對位置，檢查疊字對得準不準
2. **手動編輯介面**（雙擊預覽圖，或按預覽右下角的「手動編輯」按鈕開啟）：把 OCR 辨識出來的每一行文字變成可以點選的「文字方塊」，使用者可以拖曳調整位置、修改/刪除文字內容、改字級、改顏色；也有同樣的兩個透明度拉桿；左下角有一個「全部文字改透明」開關——打開後，疊字視覺上完全看不到（跟底圖融為一體），但**仍然是真正的 HTML 文字**，可以被選取、被搜尋引擎/AI 讀到。按「儲存」後，依編輯後的內容重新產生 HTML 並更新主畫面的預覽。

**本次只列計畫，不實作。**

## 二、現況調查

| 項目 | 現況 | 跟這次功能的關係 |
|------|------|------|
| 資料模型 | `detectedLines`（陣列）：`{ text, leftPct, topPct, widthPct, heightPct, fontSizeCqw, color, shadow }`，OCR 辨識完就固定下來，唯讀 | 編輯介面需要一份**可變動的複本**（暫稱 `editableLines`），使用者在編輯介面的所有操作都先改這份複本，按「儲存」才寫回、觸發重新產生 HTML；直接改 `detectedLines` 的話，取消編輯/重新上傳圖片的行為會變得難以預期 |
| HTML 產生 | `buildFinalHtml(altText)` 讀 `detectedLines` + `imageDataUrl` 組出字串，`generateAndPreview()` 呼叫它並把結果餵進 `htmlOutput` 與 `wpPreviewFrame.srcdoc` | 「儲存」時的動作本質上就是：拿編輯後的 `editableLines` 取代 `detectedLines`，再呼叫一次同一套流程，**不用另外寫一套產生邏輯** |
| 預覽渲染 | `<iframe id="wpPreviewFrame">` 用 `srcdoc` 渲染，內容是獨立文件（跟主頁面隔離），可以用 `wpPreviewFrame.contentDocument` 存取內部 DOM（同源，`srcdoc` 沒有跨源限制） | 透明度拉桿要嘛直接操作 `contentDocument` 內的元素 style（輕量，不用重新產生整個 `srcdoc`），要嘛編輯介面乾脆不用 iframe、直接用一般 DOM 蓋一層（見「四、2」的決策點） |
| 顏色/字級資料 | 顏色是 `rgb(r,g,b)` 字串（Otsu 萃取），字級是 `Xcqw`（相對圖片寬度的容器查詢單位） | 編輯介面的顏色選擇器（`<input type="color">`）只吃 hex 格式，需要 rgb↔hex 轉換；字級editor 要嘛讓使用者直接輸入 cqw 數值，要嘛換算成使用者好理解的「相對於圖片寬度的百分比」或抓一個參考顯示大小換算 |

## 三、需求拆解

### 1. 預覽區透明度拉桿（不影響 HTML）

- 兩個 `<input type="range">`：「底圖透明度」「疊字透明度」，緊鄰 `#wpPreviewWrap`
- 拖動時直接操作 `wpPreviewFrame.contentDocument` 內對應元素的 `style.opacity`（`<img>` 一個，所有疊字 `<div>` 一組），**不呼叫 `buildFinalHtml()`、不改 `htmlOutput.value`**——這是使用者特別強調的一點，純粹是預覽時的檢視輔助
- 重新按「產生 HTML」（或重新上傳圖片）時，拉桿重置回 100%

### 2. 觸發手動編輯介面

- 雙擊 `#wpPreviewFrame`（iframe 本身可以正常收到 `dblclick` 事件）
- 或按預覽圖右下角一顆「手動編輯」按鈕（`position:absolute`，疊在預覽區右下角）
- 兩者都開啟同一個編輯介面（用 `<dialog>` 元素或全螢幕覆蓋的 `<div>` 皆可，傾向 `<dialog>`：瀏覽器原生支援、有內建的 modal 語意跟 `Esc` 關閉行為，不用自己刻）

### 3. 編輯介面本體

**畫布區**：不建議沿用 iframe（在 iframe 內做拖曳互動要處理事件穿透/座標轉換，複雜度不成比例），改成**在編輯介面自己的 DOM 裡，用跟 `renderPreview()` 一樣的手法重新畫一份**（`<img>` + 一組 `position:absolute` 的文字方塊 `<div>`），資料來源是 `editableLines`（`detectedLines` 的深複製）。

**文字方塊互動**：
- 點擊方塊 = 選取（框選外觀，例如加一圈外框/控制點），同時開啟一個編輯面板（側邊欄或方塊旁的浮動小工具列）顯示：文字內容（`<textarea>` 或直接 `contenteditable`）、字級（數字輸入或拉桿）、顏色（`<input type="color">`，需要 rgb↔hex 轉換）
- 拖曳方塊 = 改位置：用 `pointerdown`/`pointermove`/`pointerup` 監聽（涵蓋滑鼠+觸控），拖曳時即時更新該行的 `leftPct`/`topPct`
- 刪除方塊 = 方塊上一個小的「✕」按鈕，點了就把該行從 `editableLines` 移除（畫面上這塊文字完全消失，最終 HTML 也不會有這一行）
- （不在這次範圍，但列出來當未來擴充）新增全新的文字方塊——使用者這次沒提出這個需求，先不做，`editableLines` 目前只能刪減/修改 OCR 辨識出來的既有項目

**透明度拉桿**：跟預覽區一樣的兩條拉桿，操作編輯介面自己畫布上的元素 style，**同樣不影響最終 HTML**（用途是編輯時方便檢視，跟外面那組拉桿的定位一致）——**這是本計畫的一個假設，見「五、待確認事項」第 1 條，需要使用者確認**

**「全部文字改透明」開關**（編輯介面左下角）：這個**會影響最終 HTML**（跟上面兩條拉桿性質不同，不是純預覽）。打開時，儲存下去的每一行文字顏色改成 `transparent`（或等效的 `rgba(r,g,b,0)`，保留原本顏色資訊但透明度歸零，方便之後關掉開關還原），畫面上完全看不到疊字，但因為還是真正的 `<div>` 文字（不是 `display:none`、不是拿掉），螢幕閱讀器、搜尋引擎爬蟲、AI 都讀得到，滿足「文字要能被索引，但不想看起來像疊了兩層字」的情境（考慮到底圖本身可能已經有畫文字進去，這個開關讓使用者選擇不要視覺上重複顯示，但保留 SEO/可及性的好處）。

### 4. 儲存流程

按「儲存」→ `detectedLines = editableLines`（把編輯結果寫回正式資料）→ 呼叫既有的 `generateAndPreview()`（或等效邏輯）重新產生 `htmlOutput` 跟外層的 WordPress 預覽 → 關閉編輯介面 dialog。

## 四、需要新增的資料結構與函式（規劃，實作時可能微調）

```js
// 開啟編輯介面時，從 detectedLines 深複製一份，取消編輯不動到正式資料
let editableLines = [];
let allTextTransparent = false; // 「全部文字改透明」開關狀態
let selectedLineIndex = null;   // 目前選取的文字方塊

function openEditor() { /* 深複製 detectedLines → editableLines，畫出可拖曳畫布 */ }
function renderEditorCanvas() { /* 依 editableLines 畫文字方塊，綁拖曳/點擊事件 */ }
function selectLine(index) { /* 顯示編輯面板，帶入該行目前的文字/字級/顏色 */ }
function deleteLine(index) { /* editableLines.splice(index,1)，重繪畫布 */ }
function saveEditor() {
  detectedLines = editableLines.map(line => allTextTransparent
    ? { ...line, color: toTransparent(line.color) }
    : line
  );
  generateAndPreview();
  editorDialog.close();
}
```

## 五、待確認事項

1. **編輯介面裡的兩條透明度拉桿，儲存後要不要保留？** 目前計畫假設「純預覽用，不影響 HTML」（跟外層預覽區的拉桿定位一致），但編輯介面畢竟是「調整完就要存檔」的情境，也可能你其實希望這裡的透明度**設定值本身**（不是拉桿操作過程）在儲存時一起寫進去。麻煩確認是哪一種。
2. **「重新刪減」的範圍**：是指「刪除整個文字方塊（連同位置一起消失，最終 HTML 不會有這行）」，還是「只能刪改方塊內的文字字串內容（方塊本身留著、換文字）」？目前計畫兩者都做（既可以改文字內容、也可以整塊刪除），如果你只要其中一種，可以簡化。
3. **要不要支援新增全新的文字方塊**（不是 OCR 辨識出來的，使用者自己手動加一塊）？這次描述聽起來只需要「調整既有方塊」，先不做，但列成待確認避免我猜錯範圍。
4. **文字方塊的寬高要不要能拖曳調整**，還是維持現在「寬高由 OCR 邊界框決定、字級改變時內容自動換行/溢出裁切」這種自動行為？這次需求只提到位置/文字/字級/顏色，沒提到方塊尺寸本身，先假設**寬高不用手動調**，字級變大讓文字自然撐開視覺大小。
5. **「全部文字改透明」是否需要之後也做成「個別文字方塊各自可以設透明」**（而不是只有全部一起開關）？這次先做全域開關（符合描述），但架構上會盡量讓之後要做成逐行控制不用整個重寫。

## 六、分階段實作步驟

- [ ] Phase A — 預覽區透明度拉桿：UI（兩條 range input）+ 直接操作 `wpPreviewFrame.contentDocument` 內元素 style，不動 `htmlOutput`
- [ ] Phase B — 編輯介面觸發：雙擊預覽 iframe + 「手動編輯」按鈕（右下角，疊在預覽區上），兩者都開啟同一個 `<dialog>`
- [ ] Phase C — 編輯介面畫布：依 `editableLines` 畫出可點選的文字方塊，點擊 = 選取+開編輯面板，拖曳（pointer events）= 改位置
- [ ] Phase D — 編輯面板：文字內容/字級/顏色的輸入控制項，即時反映到畫布上對應方塊；刪除方塊按鈕
- [ ] Phase E — 編輯介面的透明度拉桿（依「五、1」的回覆決定行為）+「全部文字改透明」開關
- [ ] Phase F — 儲存流程：`editableLines` 寫回 `detectedLines`（套用透明開關），呼叫既有產生邏輯更新 `htmlOutput`/外層預覽，關閉編輯介面
- [ ] Phase G — 驗證：拖曳位置、改文字/字級/顏色、刪除方塊、透明開關開/關，各自存檔後檢查 `htmlOutput` 內容正確反映編輯結果；確認取消編輯（不按儲存直接關閉）不會動到原本的 `detectedLines`；確認透明開關存檔後產生的顏色值格式正確（`rgba(...,0)`），且關掉開關能還原原色（需要保留原色資訊，不能真的把顏色資料整個抹除）
