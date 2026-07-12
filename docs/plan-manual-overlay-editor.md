# WordPress 預覽區手動編輯介面 — 實作計畫

最後更新：2026-07-12（五個待確認事項已於當日回覆，設計依此更新，見「五」）

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
- 點擊方塊 = 選取（框選外觀，例如加一圈外框/控制點），同時開啟一個編輯面板（側邊欄或方塊旁的浮動小工具列）顯示：字級（數字輸入或拉桿）、顏色（`<input type="color">`，需要 rgb↔hex 轉換）、**透明度**（新增，見下）
- **文字內容編輯**（回應「五、2」）：方塊本身在畫布上直接 `contenteditable="true"`，選取後可以原地打字修改內容——概念上比照 Word 的文字方塊（點了就能在方塊裡直接輸入/刪改），不透過面板另開一個 `<textarea>`
- 拖曳方塊 = 改位置：用 `pointerdown`/`pointermove`/`pointerup` 監聽（涵蓋滑鼠+觸控），拖曳時即時更新該行的 `leftPct`/`topPct`
- 刪除方塊 = 方塊上一個小的「✕」按鈕，點了就把該行從 `editableLines` 移除（畫面上這塊文字完全消失，最終 HTML 也不會有這一行）——跟上面的「原地打字修改文字」是兩個獨立操作，兩者都做（回應「五、2」）
- **新增全新的文字方塊**（回應「五、3」，確認要做）：工具列一顆「新增文字方塊」按鈕，點了在畫布中央插入一個新的空白方塊（預設文字「新文字」，字級/顏色/透明度給合理初始值），插入後自動選取並聚焦讓使用者直接開始打字，之後跟 OCR 來源的方塊一樣可拖曳/編輯/刪除。新方塊沒有 OCR 邊界框可以繼承寬高，寬高沿用下面「維持自動」的邏輯（`width:auto` 隨 `contenteditable` 內容自然撐開，不是靠 OCR bbox 換算）

**每個文字方塊自己的透明度**（回應「五、1」，取代原本規劃的「編輯介面共用一條疊字透明度拉桿」）：
- `editableLines` 每一行新增 `opacity` 欄位（0~1，預設 1），跟字級/顏色一樣是**這個方塊自己的屬性**，選取方塊時側邊面板出現透明度滑桿，調整的是**這個方塊自己的**值
- 跟字級/顏色一樣，這個值會被存進最終 HTML（該行 `<div>` 的 `style` 加一段 `opacity: X;`），**不是純預覽**——可以單獨把某一行文字調到全透明，同時保留可選取/可索引
- 這樣設計不用另外決定「一條共用拉桿的值儲存後要怎麼套用到全部方塊」這種語意曖昧的行為；也讓「全部文字改透明」開關（見下）可以直接建立在同一個機制上，不用另外設計

**底圖透明度拉桿**（編輯介面裡的，沿用預覽區同一顆）：維持**純預覽用**，不寫進最終 HTML——背景永遠只有一張圖，沒有「個別選取」可套，跟疊字透明度改成逐方塊持久化的理由不同，所以這顆維持原本「拉桿操作、不影響 HTML」的設計不變。

**「全部文字改透明」開關**（編輯介面左下角，回應「五、5」，確認維持全域開關、不做逐行個別 UI）：現在的角色是一個**批次動作**：打開時，儲存的當下把每個方塊的 `opacity` 一次全部覆蓋成 0；因為 `editableLines[i].opacity` 底層值本身沒被開關動過（只在存檔那一刻套用覆蓋），關掉開關後畫布顯示的還是每個方塊各自原本設定的透明度，不需要再另外設計「還原原色」這套機制（比原本規劃用 `rgba(color,0)` 改顏色本身要單純）。畫面上完全看不到疊字，但因為還是真正的 `<div>` 文字（不是 `display:none`、不是拿掉），螢幕閱讀器、搜尋引擎爬蟲、AI 都讀得到，滿足「文字要能被索引，但不想看起來像疊了兩層字」的情境。

### 4. 儲存流程

按「儲存」→ `detectedLines = editableLines`（把編輯結果寫回正式資料）→ 呼叫既有的 `generateAndPreview()`（或等效邏輯）重新產生 `htmlOutput` 跟外層的 WordPress 預覽 → 關閉編輯介面 dialog。

## 四、需要新增的資料結構與函式（規劃，實作時可能微調）

```js
// 開啟編輯介面時，從 detectedLines 深複製一份，取消編輯不動到正式資料
let editableLines = []; // 每項多一個 opacity 欄位（0~1，預設 1），跟 fontSizeCqw/color 同層級的方塊自身屬性
let allTextTransparent = false; // 「全部文字改透明」開關狀態 — 存檔時的批次覆蓋動作，不是逐行 UI
let selectedLineIndex = null;   // 目前選取的文字方塊

function openEditor() { /* 深複製 detectedLines → editableLines（缺 opacity 欄位的舊資料補預設值 1），畫出可拖曳畫布 */ }
function renderEditorCanvas() { /* 依 editableLines 畫文字方塊（含 opacity 樣式、contenteditable），綁拖曳/點擊事件 */ }
function selectLine(index) { /* 顯示編輯面板，帶入該行目前的字級/顏色/透明度；文字內容改成方塊本身 contenteditable 直接編輯，面板不需要文字欄位 */ }
function createLine() { /* 在畫布中央插入新的 editableLines 項目（預設文字「新文字」、字級/顏色/opacity=1 給合理初始值），自動選取並聚焦 */ }
function deleteLine(index) { /* editableLines.splice(index,1)，重繪畫布 */ }
function saveEditor() {
  detectedLines = editableLines.map(line => ({
    ...line,
    // 全部文字改透明：存檔當下批次覆蓋成 0，底層 editableLines 的值不變，
    // 所以關掉開關後每個方塊會各自恢復自己原本設定的 opacity，不是恢復成同一個值
    opacity: allTextTransparent ? 0 : line.opacity
  }));
  generateAndPreview(); // buildFinalHtml() 每行 <div> 的 style 要新增 opacity: ${line.opacity};
  editorDialog.close();
}
```

## 五、待確認事項（已於 2026-07-12 確認，設計依此更新）

1. **編輯介面裡的透明度拉桿，儲存後要不要保留？** → 確認：**要保留，而且進一步改成逐方塊各自的透明度**，不是原本規劃的「一條共用拉桿套用到全部疊字」。設計調整：`editableLines` 每項新增 `opacity` 欄位，跟字級/顏色一樣是選取方塊後才在面板調整的**該方塊自己的**屬性，會被存進最終 HTML；底圖透明度拉桿（背景圖沒有「個別選取」的概念可套）維持原本純預覽、不存檔的設計不變。詳見「三、3」。
2. **「重新刪減」的範圍** → 確認：**兩者都做**。文字內容編輯方式定調為「畫布上的方塊直接 `contenteditable`，跟 Word 文字方塊一樣點了就能原地打字修改」，不是側邊 `<textarea>`；整塊刪除是另一個獨立按鈕/互動，兩者並存。
3. **要不要支援新增全新的文字方塊** → 確認：**要做**。工具列加「新增文字方塊」按鈕，新方塊沒有 OCR 邊界框可繼承，寬高採用跟「4.」一樣的自動撐開邏輯，預設文字/字級/顏色/透明度給合理初始值，插入後自動選取聚焦。對應新增 `createLine()` 函式（見上）。
4. **方塊寬高要不要能拖曳調整** → 確認：**先維持自動**，跟原計畫假設一致，設計不變。
5. **「全部文字改透明」是否要做成逐行個別控制** → 確認：**維持全域開關**，不做逐行切換 UI。但因為「1.」已經讓每個方塊有自己的 `opacity` 欄位，這個開關現在的角色改成「存檔時一鍵把所有方塊的 opacity 覆蓋成 0」的批次捷徑，跟逐方塊透明度共用同一套機制（不再需要原本規劃的「改顏色 alpha 值 + 還原原色」那套獨立邏輯）。

## 六、分階段實作步驟

- [ ] Phase A — 預覽區透明度拉桿：UI（兩條 range input）+ 直接操作 `wpPreviewFrame.contentDocument` 內元素 style，不動 `htmlOutput`
- [ ] Phase B — 編輯介面觸發：雙擊預覽 iframe + 「手動編輯」按鈕（右下角，疊在預覽區上），兩者都開啟同一個 `<dialog>`
- [ ] Phase C — 編輯介面畫布：依 `editableLines` 畫出可點選的文字方塊（含 `opacity` 樣式），點擊 = 選取+開編輯面板，拖曳（pointer events）= 改位置；**文字內容直接在方塊本身用 `contenteditable` 原地編輯**（不是面板裡的 textarea）
- [ ] Phase D — 編輯面板：字級/顏色/**透明度**（新增，逐方塊各自的 `opacity`）的輸入控制項，即時反映到畫布上對應方塊；刪除方塊按鈕；**「新增文字方塊」按鈕 + `createLine()`**（新增，插入無 OCR 來源的空白方塊，寬高自動撐開）
- [ ] Phase E — 編輯介面自己的底圖透明度拉桿（維持純預覽，不存檔）+「全部文字改透明」全域開關（存檔時批次把所有方塊 `opacity` 覆蓋成 0，底層值不變、關掉能各自復原）
- [ ] Phase F — 儲存流程：`editableLines` 寫回 `detectedLines`（套用「全部改透明」的批次覆蓋），呼叫既有產生邏輯更新 `htmlOutput`/外層預覽（`buildFinalHtml()` 的行 `<div>` 樣式新增 `opacity: ${line.opacity};`），關閉編輯介面
- [ ] Phase G — 驗證：拖曳位置、原地編輯文字、改字級/顏色/**透明度**、刪除方塊、**新增文字方塊**（插入後可拖曳/編輯/刪除，行為跟 OCR 來源方塊一致）、全部改透明開關開/關，各自存檔後檢查 `htmlOutput` 內容正確反映編輯結果（尤其逐方塊 `opacity` 值要各自獨立，不是全部同一個值）；確認取消編輯（不按儲存直接關閉）不會動到原本的 `detectedLines`；確認全部改透明開關存檔後每個方塊 `opacity` 都是 0，關掉開關後每個方塊恢復自己原本設定的透明度（不是恢復成同一個值，也不需要另外還原顏色）
