# 人工複查 Checklist — 靜態預檢腳本抓不到、但不需要實跑測試就能抓的 bug

*建立於 2026-07-13，2026-07-14 複查並更新（架構已大改：編輯視窗方塊互動從「圓形移動把手 `.ovMoveHandle` ＋ 角落限定 4 縮放把手 ＋ 右上角 `.ovDeleteBtn` × 鈕」換成「貼齊文字外緣的 `.ovBoxFrame` 框線 ＋ 8 個控點（四角+四邊中點）＋ Delete/Backspace 鍵刪除」，見下方各項目裡標記「2026-07-14」的複查小節）*

`scripts/precheck.js` 能抓的是「機械式比對」類的錯誤（DOM id 打錯、import 對不上 export、檔案不存在、HTML 標籤沒對齊）。但很多真實的 bug 屬於**邏輯/推理層級**——沒有拼寫錯誤、語法完全合法，程式「看起來」沒問題，只有實際順著執行流程、跨檔案追蹤資料流、想邊界情境，才看得出來。這份清單就是列出這一類、可以純靠**讀程式碼＋推理**找到（不需要真的開瀏覽器點來點去）的問題類型，之後每次改完重大功能都可以拿出來重新過一輪。

每個項目分三部分：**要檢查什麼**（這一類 bug 的特徵）、**這次稽核結果**（2026-07-13 這輪實際檢查出什麼）、**狀態**。

---

## 1. 跨非同步邊界的共用可變狀態（race condition）

**要檢查什麼**：模組層級的 `let` 變數如果被多個非同步流程共用（例如兩次使用者操作都會觸發同一段 `async` 函式），要確認先開始但後結束的那次操作，不會用「後來被其他操作改掉」的共用變數去做計算或寫回畫面。這類 bug 平常測試很難踩到（要精準卡時間點連續觸發兩次），但純讀程式碼可以看出來：只要看到 `let` 宣告在模組頂層、又在一個 `async` callback 深處被讀取，且中間沒有任何「這次操作專屬」的識別碼，就要懷疑。

**這次稽核結果**：`js/main.js` 的 `imageDataUrl`／`naturalWidth`／`naturalHeight`／`detectedLines` 都是模組層級 `let`，`imageInput` 的 `change` handler 是 `async`，裡面又巢狀一個 `img.onload` 的 `async` callback，OCR 辨識（`await recognizeWith...`）可能跑好幾秒。如果使用者上傳圖片 A 後，趁 A 的 OCR 還在跑，馬上又上傳圖片 B：
1. B 的 `change` handler 立刻把 `imageDataUrl`/`naturalWidth`/`naturalHeight` 蓋成 B 的值
2. A 那個還在背景跑的 OCR 完成後，用**當下**（已經被 B 蓋掉的）`naturalWidth`/`naturalHeight` 去算 A 的文字位置百分比 → 算出來的位置是錯的
3. A 接著呼叫 `mountEditor(A的detectedLines, imageDataUrl)`，這時 `imageDataUrl` 也已經是 B 的圖了 → 畫面上顯示「B 的圖 + A 算錯位置的文字方塊」，把使用者剛看到的 B 編輯畫面整個覆蓋掉

**狀態**：✅ 已修 — 加入單調遞增的 `uploadToken`，每次上傳開始時遞增並記住當下的值；OCR 完成後套用結果前（`mountEditor()`、`ocrStatus` 更新、`generateBtn` 狀態）都先確認 token 沒有被更新的上傳蓋過，過期的直接靜默捨棄。

**2026-07-14 複查**：後來新增的「← 上一步」`resetWorkspace()` 沿用同一個 `uploadToken` 機制（重置時遞增），會正確擋掉重置當下還在跑的舊 OCR 結果寫回。仍然乾淨，不需要再修。

---

## 2. 缺少的錯誤處理路徑

**要檢查什麼**：找每一個 `new Image()`／`new FileReader()`／`fetch()`／瀏覽器 API 呼叫，確認「失敗」路徑（`onerror`、`.catch()`、rejected promise）有沒有被接住。沒接住不代表程式會當掉，而是**使用者會卡在一個沒有任何回饋的狀態**，這種 bug 平常操作正常檔案完全踩不到，只有想到「如果這一步失敗會怎樣」才看得出來。

**這次稽核結果**：
- `js/main.js` 的 `img.onload` 有寫，但**完全沒有 `img.onerror`**——如果使用者選到的檔案不是有效圖片（副檔名是 .png 但內容是壞的/空的/其實是別種檔案），`onload` 永遠不會觸發，畫面永遠停在「載入圖片中…」，沒有任何錯誤訊息，使用者不知道發生什麼事。
- `copyBtn` 的 `navigator.clipboard.writeText()` 沒有包 `try/catch`——這個 API 在非安全上下文（http 而非 https）、瀏覽器權限被拒、或分頁失焦時會 reject，目前完全沒接住，使用者按下複製會沒反應、也不會有錯誤提示，只有 console 會噴一個沒人看的 unhandled rejection。
- `js/ocr-paddle.js`／`js/ocr-vision.js`／`js/ocr-tesseract.js` 內部的 `fetch`/`Image`/`Tesseract.recognize` 失敗都會正確 `throw`，並且都被 `js/main.js` 裡對應的 `try/catch` 接住、轉成使用者看得懂的錯誤訊息——這條路徑是乾淨的，不需要修。

**狀態**：✅ 已修 — `img.onerror` 補上，失敗時顯示明確錯誤訊息並讓使用者能重新選檔；`copyBtn` 包 `try/catch`，失敗時顯示「複製失敗，請手動選取後 Ctrl+C」之類的提示而不是靜默失敗。

**2026-07-14 複查**：重新過一次 `js/main.js`／`js/ocr-*.js` 全部的 `fetch`/`new Image()`/`new FileReader()` 呼叫點，錯誤路徑都還在且正確接住；`js/editor.js` 的 `cancelEditorBtn`/`.ovBoxFrame` 新增的程式碼沒有引入任何新的瀏覽器 API 呼叫（`textEl.blur()`／`frame.focus()`／陣列操作都不會 reject/throw）。乾淨，不需要再修。

---

## 3. 邊界值/夾限（clamping）不對稱

**要檢查什麼**：如果一個數值在「變大」方向有夾限（`Math.max`/`Math.min`），但「變小」或「另一個維度」沒有對應夾限，通常是漏改，不是刻意設計。純讀程式碼就能發現：看每個座標/尺寸計算，確認所有會被更新的欄位是不是都套了一致的限制。

**這次稽核結果**：`js/editor.js` 的縮放拖曳（`pointermove` 內的 resize 分支）對 `widthPct`/`heightPct` 都有 `Math.max(MIN_BOX_PCT, ...)` 下限，但**移動拖曳**（`type === 'move'` 分支）完全沒有對 `leftPct`/`topPct` 做任何範圍限制——可以把方塊拖到左上角變成負數、或右下角超過 100%。畫布容器 `#editorCanvasWrap` 又是 `overflow: hidden`，方塊拖太遠會被裁切到完全看不見；而且編輯面板沒有「位置」數值輸入框，只能用滑鼠重新抓到方塊的把手才能拖回來——但方塊已經看不到了，等於卡死，使用者唯一的救法是刪掉重建。

**狀態**：✅ 已修 — 移動與縮放都夾限 `leftPct`/`topPct` 在 `[-(100-MIN_BOX_PCT), 100-MIN_BOX_PCT]`附近的合理範圍內（保留方塊至少一小角落在可視範圍內可以被抓到），不會再出現「拖出去就抓不回來」的情況。

**2026-07-14 複查**：縮放邏輯從「四個角落各自獨立分支」改寫成「用 `corner.includes('e'/'w'/'n'/'s')` 統一判斷八個方向」（見 `js/editor.js` 的 `pointermove` handler），純邊中點控點（`n`/`s`/`e`/`w`）只改一個維度、角落控點（`nw`/`ne`/`sw`/`se`）改兩個維度，兩種情況算完都一樣呼叫 `clampLine(line)`，夾限邏輯完全沒變、對稱性沒有被新的 8 方向邏輯破壞。用合成 `PointerEvent` 分別測了 `e`（只改寬度）跟 `nw`（四個值都正確變化）兩種控點，數值符合預期。

---

## 4. 鍵盤操作可達性（不需要螢幕閱讀器，純讀程式碼看有沒有寫 keydown）

**要檢查什麼**：凡是滑鼠拖曳/點擊才能做到的操作，檢查有沒有對應的鍵盤事件處理。純讀程式碼就能確認：搜尋 `pointerdown`/`pointermove`/`click` 的互動點，看旁邊有沒有對應的 `keydown`。

**這次稽核結果**：`.ovMoveHandle`／`.ovResizeHandle` 只掛了 pointer 事件，完全沒有 `keydown`——純鍵盤使用者（Tab 導覽）可以用 Tab 把焦點移到移動把手上，但按方向鍵完全沒反應，沒有任何方式能移動或縮放文字方塊，只能靠滑鼠。

**狀態**：✅ 已修（原始版本）— 移動把手（`.ovMoveHandle`）取得焦點時，方向鍵可以微調位置（一般 0.5%，按住 Shift 為 2%），符合常見的「方向鍵微調」慣例。縮放把手因為要分辨四個角落方向、邏輯較複雜，這次先不做鍵盤版本（純滑鼠使用者的核心需求已經有拖曳把手，鍵盤使用者至少能移動，缺縮放鍵盤操作視為已知限制而非阻斷性問題）。

**2026-07-14 複查（架構已改）**：`.ovMoveHandle` 已被移除，方向鍵微調＋Delete/Backspace 刪除的鍵盤路徑改綁在新的 `.ovBoxFrame`（`tabIndex=0`，`role="button"`）上，行為維持一致（0.5%／Shift+2%）。縮放（8 個控點）依然沒有鍵盤版本——維持原本的已知限制判斷，不算新問題。**驗證時額外發現一個真的鍵盤可及性 bug**：`.ovBoxFrame:focus { outline: none; }` 把瀏覽器預設的焦點外框整個拿掉，卻沒有補上任何替代的視覺提示——鍵盤使用者 Tab 到某個方塊時完全看不出來焦點在哪一個方塊上，等於在不知情的狀況下按 Delete 可能刪錯方塊。已修：加上 `.ovBoxFrame:focus-visible { outline: 2px solid var(--highlight); outline-offset: 2px; }`（用 `:focus-visible` 而不是 `:focus`，滑鼠點擊不會觸發、只有鍵盤導覽才會顯示）。

---

## 5. 圖示型按鈕缺少無障礙名稱

**要檢查什麼**：找所有 `textContent` 是純符號/emoji（不是可讀文字）的 `<button>`，確認有 `aria-label`（`title` 屬性螢幕閱讀器不保證會讀，`aria-label` 才是正規做法）。

**這次稽核結果**：`.ovMoveHandle`（✛）、`.ovDeleteBtn`（×）都只有 `title`，沒有 `aria-label`。

**狀態**：✅ 已修（原始版本）— 兩者都補上對應的 `aria-label`（「拖曳移動位置」／「刪除這個文字方塊」，跟現有 `title` 文字一致）。

**2026-07-14 複查（架構已改）**：`.ovMoveHandle`／`.ovDeleteBtn` 都已移除，取代它們的 `.ovBoxFrame` 一開始就內建 `aria-label`（「文字方塊，拖曳移動位置，方向鍵微調...，Delete 鍵刪除」）＋ `role="button"`，沒有漏掉。新增的 8 個 `.ovResizeHandle` 控點維持純 `<div>`（沒有 `tabIndex`，只能滑鼠/觸控操作，不會被鍵盤 Tab 到），跟舊版角落 4 控點的無障礙狀態一致——不是新引入的缺口，是延續原本就有的已知限制（見上方項目 4）。

---

## 6. 焦點管理（元素被移除/隱藏時，焦點掉去哪）

**要檢查什麼**：任何「刪除目前有焦點的元素」或「隱藏目前有焦點元素所在的容器」的程式碼路徑，瀏覽器預設行為是焦點會掉回 `<body>`，對鍵盤使用者來說像是「操作完之後突然不知道游標在哪」。純讀程式碼可以找：`element.remove()`、`.style.display = 'none'` 前後，有沒有主動把焦點轉移到別的地方。

**這次稽核結果**：`js/editor.js` 的 `deleteLine()` 呼叫路徑（不管是面板的「刪除這個方塊」按鈕、還是方塊自己的「×」角標）刪除後都會呼叫 `renderCanvas()` 整個重建 DOM，原本有焦點的按鈕被整個移除，焦點沒有主動轉移，會掉回 `<body>`；`hidePanel()` 把面板 `display:none` 也一樣。

**狀態**：✅ 已修 — 刪除方塊後，焦點轉移到畫布容器本身（`#editorCanvasWrap`，`tabindex="-1"` 讓它可以被程式化聚焦，避免焦點憑空消失）。

**2026-07-14 複查（架構已改）**：面板的「刪除這個方塊」按鈕（`#deleteLineBtn`）已經整個移除（使用者要求，方塊自己的「×」角標功能重複）；方塊自己的「×」角標也已移除，刪除改成「選取方塊後按 Delete/Backspace」（鍵盤事件目標是 `.ovBoxFrame`）。目前的 `deleteLine()` 程式碼是**焦點永遠轉移到 `#editorCanvasWrap`**，不分「刪光了」還是「還有其他方塊」——比舊版描述的「還有方塊就轉去新增按鈕」簡單，這是介面重做時順帶簡化的，行為仍然正確（焦點不會憑空消失），只是這份文件先前的敘述沒跟著更新，現在補上讓文件符合實際程式碼。

---

## 7. 使用者輸入/機密資料絕對不能外流到輸出

**要檢查什麼**：凡是有「使用者填的機密資訊」（這裡是 Google Vision API 金鑰），要確認產生的最終輸出（`buildFinalHtml()` 的回傳值、JSON-LD、複製的 HTML）完全沒有任何路徑會讀到它。純讀程式碼：搜尋 `apiKeyInput`，確認只出現在辨識請求跟 localStorage 存取，不出現在 `html-builder.js` 或任何 innerHTML 組字串的地方。

**這次稽核結果**：確認 `apiKeyInput` 只在 `js/main.js` 的辨識請求跟記住金鑰的 localStorage 讀寫出現，`js/html-builder.js` 完全沒有引用它。乾淨，不需要修。

**狀態**：✅ 已確認無問題（純驗證，沒有改動）。

**2026-07-14 複查**：`apiKeyInput` 出現的位置沒有變（還是只在 `js/main.js` 的辨識請求跟 localStorage 存取），`js/html-builder.js` 依然完全沒有引用它。乾淨。

---

## 8. 使用者可見文字的 HTML 跳脫一致性

**要檢查什麼**：找出所有「使用者可以自訂內容」最終會被組進 HTML 字串（不是透過 `textContent`/`el.value` 這種天生安全的 DOM API）的地方，確認每一處都有跳脫。純讀程式碼：搜尋樣板字串裡的 `${...}` 內插，對照該變數的來源是不是使用者輸入。

**這次稽核結果**：`altText`（→`escapeHtml()`，用在 `alt`、`figcaption`）、每行疊字文字 `line.text`（→`escapeHtml()`）、JSON-LD（`JSON.stringify` + 額外跳脫 `<` 防止 `</script` 提早結束標籤）都有正確處理；`line.color`/`line.shadow` 不是自由文字（只會是程式產生的 `rgb(...)` 字串或寫死的陰影值），沒有注入風險。乾淨，不需要修。

**狀態**：✅ 已確認無問題（純驗證，沒有改動）。

**2026-07-14 複查**：`line.text`／`altText` 的跳脫路徑沒變；`js/line-merge.js` 這次改動只碰幾何/字級比對邏輯（`heightPct`／`_lastHeightPct`），沒有碰 `text` 欄位本身的處理方式，合併後的 `text`（含 `\n`）一樣是透過既有的 `escapeHtml()` 路徑輸出。乾淨。

---

## 9. 瀏覽器 API 呼叫本身會 throw 的防呆（這項是驗證第 3 項時意外抓到的，不是原本的清單項目）

**要檢查什麼**：呼叫任何「規格上明文說會在某些條件下 throw」的瀏覽器 API（不是我們自己的邏輯錯誤，是 API 本身的正常行為），要確認呼叫點有沒有用 try/catch 包住，尤其是這個 API 呼叫「失敗也不影響核心邏輯」（是個加分/優化用途）的情況——這種時候讓例外往外拋，會把後面**完全不相關**的程式碼一起拖下水中斷執行。這一類純讀程式碼比較難發現（要對照 MDN 規格才知道哪些 API 會 throw），比較實際的做法是：在驗證其他修復項目時，只要有牽涉到互動流程的程式碼，都可以順手測一次「這個 API 呼叫失敗會怎樣」。

**這次稽核結果**：在瀏覽器裡驗證第 3 項（拖曳夾限）修復時意外發現：`js/editor.js` 的 `pointerdown` handler 裡 `handle.setPointerCapture(e.pointerId)` 沒有包 try/catch，直接寫在 `dragState = {...}` **賦值之前**。`setPointerCapture` 在瀏覽器判斷該 pointerId「目前不是作用中的指標」時會丟出 `InvalidPointerId` 例外（測試時用合成 `PointerEvent` 重現到了）——一旦這裡 throw，整個 `pointerdown` handler 提早中斷，**後面的 `dragState = {...}` 永遠不會執行**，導致這次拖曳從頭到尾都是無效的（`pointermove` 進來時 `dragState` 是 `null`，直接被忽略），而且沒有任何錯誤訊息，看起來就像「拖曳完全沒反應」。`setPointerCapture` 本質上只是一個「即使游標移出方塊範圍也持續收到事件」的加分優化（本來就有 `editorCanvasWrap` 上的 delegated 監聽器兜底），失敗了不該讓整個拖曳邏輯報廢。

**狀態**：✅ 已修 — `setPointerCapture` 呼叫包 try/catch，失敗時靜默忽略（拖曳仍透過 delegated 監聽器正常運作），`dragState` 保證會被設定。

**2026-07-14 複查**：新的 `pointerdown` handler（`.ovBoxFrame`／`.ovResizeHandle` 共用同一段）保留了同一個 try/catch 包住 `setPointerCapture`，而且一樣寫在 `dragState = {...}` 賦值之前——這次重寫時特別注意保留這個防呆，沒有被改掉。乾淨。

---

## 10. 浮動選單的 focus trap（低優先度，這次不修）

**要檢查什麼**：`settingsPanel` 是自製的浮動選單（不是 `<dialog>`），開啟時 Tab 鍵理論上可以繼續移動到選單「後面」被遮住的頁面元素上。

**這次稽核結果**：確認沒有 focus trap。但這是一個小工具頁面、選單背後沒有危險/會誤觸的操作，加 focus trap 的複雜度（要處理 Tab/Shift+Tab 循環、開啟時記住/關閉時還原前一個焦點）跟這個工具的規模不成比例。

**狀態**：⏭️ 已知限制，這次不修（記錄下來避免未來被誤認為「沒發現」）。

---

## 11. 視覺不可見狀態（opacity:0 等）下的可發現性／可點擊性（2026-07-14 新增）

**要檢查什麼**：任何「元素故意可以被使用者調成完全看不見」的功能（透明度滑桿、全域透明開關），要確認調成看不見之後，使用者依然有辦法**找到並操作**它（不是靠記憶硬點空白處），尤其是這個元素同時又是唯一的互動入口（沒有另外的列表/清單可以選）的情況。純讀程式碼可以看：「這個元素平常的可見樣式」跟「互動用的把手/邊框」是不是同一份、共用同一個透明度/顯示狀態。

**這次稽核結果**：使用者實際使用時回報「文字變成完全透明後選取不到」。追查發現：`js/editor.js` 的 `.ovBoxFrame`（方塊的拖曳/選取框線）原本預設 `border: 1px solid transparent`，只有 `:hover` 時才變成看得見的虛線提示。當方塊的文字本身也是 `opacity:0`（「全部文字改透明」開關或手動把不透明度拉桿拉到 0，這是這個工具刻意支援的正常情境——疊字要能在視覺上完全隱形、但依然是真正可選取/可複製的文字，見下方確認的部分）時，畫面上**完全沒有任何東西**可以拿來 hover/點擊，等於這個方塊從編輯視窗裡消失了，唯一的救法是打開瀏覽器開發者工具直接改 DOM。**先確認核心承諾沒被破壞**：寫了一個獨立測試，對一個 `opacity:0` 的 `<div>` 用 `Range`／`Selection` API 選取文字內容，確認選取正常運作（`opacity:0` 不影響瀏覽器原生的文字選取/複製，只是滑鼠沒辦法用「拖曳選取」這種需要看得到才能瞄準的操作方式）——所以**最終產生的 HTML 本身沒有問題**，問題只在編輯視窗這個互動介面上。

**狀態**：✅ 已修 — `.ovBoxFrame` 的預設邊框從完全透明改成 `border: 1px dashed rgba(0,0,0,0.18)`（一直都有一圈淡淡的提示線，不需要 hover 或選取狀態才看得到），不管方塊文字本身透明度多少，框線本身都不受影響（框線是獨立的 CSS `border-color`，不是繼承文字的 `opacity`）。用合成測試確認：把文字 opacity 設 0 並取消選取狀態，框線的 `border-color` 依然不是 `rgba(0,0,0,0)`（不透明），可以被找到並點擊。

---

## 12. `document.activeElement` vs `:focus`／`:focus-within` CSS selector（2026-07-14 新增，這次驗證環境意外踩到）

**要檢查什麼**：JS 邏輯裡用「CSS pseudo-class 當 selector 查詢」（例如 `el.querySelector('.foo:focus')`、`el.matches(':focus')`）來判斷目前的焦點狀態，理論上跟直接比對 `document.activeElement` 應該等價，但两者在部分瀏覽器/測試環境下可能不同步。純讀程式碼比較難抓到這類（要實際測才會發現不一致），但只要看到程式碼裡用 `:focus`／`:active` 這種狀態型 pseudo-class 當 JS 查詢條件（不是純 CSS 樣式），就該留意有沒有更直接的 JS API 可以取代。

**這次稽核結果**：這次重寫方塊互動時，原本寫的是 `box.querySelector('.ovBoxText:focus')` 來判斷「這個方塊的文字目前是不是正在被輸入」，用瀏覽器互動測試驗證時發現：即使 `document.activeElement` 已經正確指向該元素、`:focus-within`（在祖先元素上查）也正確判定為 `true`，唯獨 `.ovBoxText:focus` 這個直接查詢抓不到、`el.matches(':focus')` 也回傳 `false`。改用 `document.activeElement === textEl` 直接比對後行為就正確了。**不確定這是真實瀏覽器普遍的行為還是這次測試環境的特性**（這個專案先前已經記錄過好幾次同一個測試工具的環境限制：`requestAnimationFrame`／`<dialog>` 的 `close` 事件／`IntersectionObserver` 都在這個工具裡不會正常觸發，這次的 `focus` 事件本身也不會在程式化 `.focus()` 呼叫後觸發，只有 `document.activeElement` 跟 `:focus-within` 的即時狀態是可信的）——但不論成因為何，`document.activeElement` 比較直接、不依賴 CSS 引擎的即時性，是更穩健的寫法，值得記錄下來當一般性原則。

**狀態**：✅ 已修 — `js/editor.js` 的 `pointerdown` handler 判斷「要不要把文字方塊 blur 掉」時改用 `document.activeElement === textEl`。

---

## 使用方式

之後每次做完較大的功能異動，重新過一次這份清單（尤其是第 1、2、3 類——狀態管理/錯誤處理/邊界值是最容易在改功能時不小心破壞的），需要的話直接在對應項目下面加新的「這次稽核結果」小節，不要覆蓋掉舊的紀錄。
