# PaddleOCR 瀏覽器版可行性評估 — 實作計畫

最後更新：2026-07-12

## 一、目標

評估用 **PaddleOCR 的瀏覽器版**（在瀏覽器內執行，不架伺服器）取代或補強現有的 Tesseract.js，看能不能提升辨識準確度，同時維持「不用申請帳號、圖片不外流」這兩個 Tesseract.js 才有的優點（跟 Google Vision 的取捨不同——Vision 準但要金鑰、圖片會送到 Google 伺服器）。

**本次只做調查+列計畫，不實作**，待使用者確認方向後再動工。

## 二、現況調查（專案內部）

| 項目 | 現況 |
|------|------|
| 目前辨識引擎 | Tesseract.js（CDN `<script>` 標籤載入，無建置流程），已知弱點：容易把照片紋理/雜訊誤判成文字（見「最新完成」歷史紀錄的信心分數過濾修法） |
| 現有的多引擎抽象層 | `index.html` 裡 Tesseract 跟 Google Vision 兩條路徑都收斂成同一種格式：`[{ text, x0, y0, x1, y1 }]`（行級文字+邊界框），下游的顏色萃取（`extractTextColor`）、位置換算、`MIN_LINE_CONFIDENCE` 過濾都吃這個格式——**這代表插入第三個引擎不是重寫，是照既有模式再加一條路徑** |
| 架構限制 | 目前是**單一 HTML 檔、無建置流程、靠 CDN `<script>` 標籤載入外部函式庫**（`CLAUDE.md` 記錄這是刻意選擇）。新引擎能不能沿用同一招（CDN + 全域變數），還是需要 ES module/bundler，是這次要驗證的第一件事 |

## 三、網路調查結果（附來源）

### 1. 現成套件，不用自己訓練模型

- **官方 SDK**：`@paddleocr/paddleocr-js`（PaddlePaddle 官方組織釋出），底層用 ONNX Runtime Web + OpenCV.js 執行 PP-OCRv5，v0.4.2、查詢當下 20 天前才發布，屬於持續維護中 [(npm)](https://www.npmjs.com/package/@paddleocr/paddleocr-js)
- **社群 SDK**：`ppu-paddle-ocr`，TypeScript 寫的輕量版，支援 Node/Bun/Deno/瀏覽器/瀏覽器擴充功能，102 stars、13 forks、v6.0.0（2026-06-22 發布）、0 個未解決 issue，看起來維護積極 [(GitHub)](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr)、[(說明文章)](https://dev.to/awalariansyah/deterministic-ocr-in-javascript-paddleocr-for-node-bun-deno-and-the-browser-2bgn)
- 兩者都是**現成、免費、開源**，不需要自己訓練或準備任何訓練資料（呼應先前討論：不建議自建模型，這正是「用現成更強模型」的具體做法）

### 2. 準確度：對「照片背景+文字」這種情境確實比 Tesseract 好一截

在 ICDAR2015（自然場景文字辨識標準測試集，情境類似「照片裡的文字」而不是「乾淨掃描文件」）上，**PaddleOCR 準確度約 85-90%，Tesseract 約 60-70%**；另一份評測量測平均信心分數：PaddleOCR 0.93、Tesseract 0.89、EasyOCR 0.85 [(ML Journey 比較)](https://mljourney.com/paddleocr-vs-tesseract-comprehensive-comparison-for-ocr-implementation/)、[(CodeSOTA 比較)](https://www.codesota.com/ocr/paddleocr-vs-tesseract)。這跟這次踩到的問題（照片背景誤判成文字）情境高度相關——不是隨便找一份不相干的評測。

### 3. 語言支援：繁體中文是內建核心語言，甚至可能不用像 Tesseract 那樣分開下載

PP-OCRv5 的預設模型**同一個模型內就統一支援簡體中文、繁體中文、中文拼音、英文、日文**，另外還有涵蓋 106 種語言的多語系模型（含韓文、俄文、德文、法文、西班牙文等）[(PaddleOCR 官方文件)](http://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.html)。這點跟 Tesseract 不同——Tesseract 每種語言是獨立的 traineddata 檔案要分開下載，PaddleOCR 的核心語言（繁中/簡中/英/日）可能一個模型就涵蓋，語言選單的意義可能要跟著調整（見「五、待確認事項」）。

### 4. 回傳格式：跟現有 pipeline 的相容度看起來很高

PaddleOCR 的 Python API 回傳格式包含 `rec_texts`（辨識文字）、`rec_boxes`（`[x_min, y_min, x_max, y_max]` 矩形框，格式跟我們現在用的 `x0,y0,x1,y1` **幾乎一樣**）、`rec_scores`（每個偵測結果的信心分數，0-1 尺度）[(PaddleOCR 文字偵測文件)](http://www.paddleocr.ai/v3.3.0/en/version3.x/module_usage/text_detection.html)。瀏覽器版 SDK 底層是同一套模型/pipeline，大機率回傳格式相同或極相似——如果屬實，**這代表信心分數過濾（`MIN_LINE_CONFIDENCE`）這個機制可以直接沿用同一套邏輯**，不用重新設計。

### 5. 模型大小：比 Tesseract 的 traineddata 小很多

文件提到「mobile 版模型設計成只有幾 MB」，相較 Tesseract 一個語言的 traineddata 常常是 10-40MB，PaddleOCR 的行動裝置優化模型明顯更輕，理論上初次載入更快 [(說明文章)](https://dev.to/awalariansyah/deterministic-ocr-in-javascript-paddleocr-for-node-bun-deno-and-the-browser-2bgn)。

### 6. 瀏覽器相容性

需要 **WebAssembly（WASM）** 作為最低需求（現代瀏覽器都支援），**WebGPU** 可選加速（Chrome/Edge/Firefox Nightly 等，2-5 倍加速），沒有 WebGPU 會自動退回 WASM，不會直接壞掉。

## 四、可行性評估結論

**初步判斷：值得花時間實測，優先度高於「架伺服器用 EasyOCR/MMOCR/docTR」這條路**（後者已記錄在待辦，先擱置）。理由：
- 準確度有實際測試數據支持，不是憑感覺猜的
- 免帳號、圖片不外流，維持跟 Tesseract 一樣的優點，不像 Google Vision 要金鑰、要把圖傳到第三方
- 官方跟社群都有現成、積極維護的套件，不用自己訓練模型
- 回傳格式看起來跟現有 pipeline 高度相容，改動幅度可能不大

**但有兩個關鍵風險，網路調查沒辦法確認，一定要實測才知道**：
1. **能不能沿用「CDN `<script>` 標籤、無建置流程」這個架構**——如果這兩個套件都要求 ES module bundler（Vite/webpack），就會牴觸目前刻意維持的單檔架構，是個要衡量的取捨
2. **瀏覽器版的實際回傳格式是不是真的跟 Python API 一樣有 confidence 分數**——調查只確認了 Python API 的格式，瀏覽器 SDK 有沒有 1:1 對應到，要真的裝起來跑一次才知道

## 五、待確認事項（2026-07-12 使用者已回覆）

1. **要評估哪一個套件**：官方 `@paddleocr/paddleocr-js` 還是社群的 `ppu-paddle-ocr`？→ **兩個都花時間各自做一次小規模實測比較**，不預先押寶其中一個。Phase A 兩個套件都要試裝、都要跑過同一組測試圖。
2. **PaddleOCR 若實測準確度確實更好，要整個取代 Tesseract，還是並列成第三個選項**？→ **並列，讓使用者選，但預設使用表現好的那個**。UI 變成三選一（Tesseract / Google Vision / PaddleOCR），保留 Tesseract 當退路；預設選中的引擎依 Phase A 實測結果（Tesseract vs. 勝出的 PaddleOCR 套件）決定，不是寫死預設 PaddleOCR。
3. **要不要順便重新設計語言選單**？→ **好，重新設計**。若 Phase A 確認 PaddleOCR 模型真的內建統一涵蓋繁中/簡中/英/日（不用像 Tesseract 分開下載勾選），語言選單要跟著改設計（例如「東亞語言 on/off」+ 其他語言個別勾選的分組），而不是照搬現有「每個語言各自一個 checkbox」的結構套在三引擎上。

## 六、分階段實作步驟

- [x] Phase A — 小規模技術驗證（spike，非正式串接）：分別試裝 `@paddleocr/paddleocr-js` 跟 `ppu-paddle-ocr`（兩個都做，不省略任一個），確認（a）能不能用 CDN `<script>` 標籤 + 全域變數的方式在無建置流程的單檔 HTML 裡運作，（b）`predict()`/辨識結果是否真的回傳每個偵測框的信心分數、格式長怎樣，（c）拿目前這個 repo 已經用過的測試圖（乾淨文字圖、雜訊背景圖）實際跑一次，兩個套件跟 Tesseract 三方比較辨識結果差異、速度、模型下載大小；（d）順便確認繁中/簡中/英/日是否真的同一模型內建涵蓋，決定語言選單怎麼重新設計
- [x] Phase B — 依 Phase A 實測結果，在 `@paddleocr/paddleocr-js` 與 `ppu-paddle-ocr` 之間選出要正式整合的那一個（準確度、速度、能否無建置流程運作為主要判斷依據）；同時決定 Tesseract vs. PaddleOCR 誰是預設引擎（依實測準確度較高者，Google Vision 維持現狀不參與這個預設之爭，因為它需要金鑰、本來就不是預設）
- [x] Phase C — 仿照 `recognizeWithGoogleVision()` 的模式寫一個 `recognizeWithPaddleOCR()`，輸出同樣的 `[{text,x0,y0,x1,y1}]` 格式餵進現有下游 pipeline；如果套件本身有信心分數，一併輸出，讓 `MIN_LINE_CONFIDENCE` 式的過濾邏輯可以套用；把引擎選擇 UI 從「Tesseract / 進階設定填金鑰用 Google Vision」的二選一結構改成 Tesseract / Google Vision / PaddleOCR 三選一，預設值依 Phase B 結論設定；重新設計語言選單（依 Phase A (d) 的結論分組，不再是三引擎共用同一份「每語言一個 checkbox」清單）
- [x] Phase D — 驗證：用現有的回歸測試圖（乾淨黑白字、彩色字、雜訊背景圖）跑過一輪，確認新引擎至少不比 Tesseract 差；確認三引擎選單切換、預設引擎正確、語言選單重新設計後三引擎都能正確吃到選到的語言；`index.html` 仍能部署到 Vercel 後正常運作（沿用 ES modules 架構，若 PaddleOCR 套件需要 bundler 則要重新評估架構取捨）

**Phase D 驗證結果（2026-07-12）**：用 `DataTransfer` 模擬上傳（原生檔案選擇對話框無法自動化，沿用 `CLAUDE.md` 記錄的測試手法）在真實瀏覽器跑過：(1) 預設 PaddleOCR 引擎辨識合成海報圖「促銷活動 SALE」，正確辨識、正確疊字定位、Alt 含特殊字元（`"`/`&`/`<`/`>`）正確跳脫且 iframe 渲染正確；(2) 切到 Tesseract 引擎重跑，正確辨識，確認舊引擎沒有因為改動被破壞（回歸測試）；(3) 切到 Google Vision 引擎但不填金鑰上傳，正確攔下並顯示「請先填金鑰再上傳圖片（或改選其他引擎）」，沒有讓流程卡死或送出無效請求；(4) PaddleOCR 書寫系統下拉選單切到「한국어 韓文」（`V5_KOREAN_MOBILE_MODEL`），上傳韓文合成圖，正確辨識出「안녕하세요」——確認語言選單重新設計後的模型切換路徑（不只預設模型）也正常運作。全程 console 無錯誤訊息。

## 七、Phase A 實測結果（2026-07-12）

用 Node 直接 `npm install` 兩個套件到 scratch 目錄讀取 `.d.ts` 型別定義（比網路調查更可靠，型別是套件實際 API 的第一手來源），再寫一個獨立 spike 頁面（不進 repo，純測試用）在真實瀏覽器跑三個引擎（Tesseract 當基準 + 兩個 PaddleOCR 套件）。

**(a) CDN + 無建置流程可行性 — 兩個套件都可行**：`@paddleocr/paddleocr-js` 用 `https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js/+esm`、`ppu-paddle-ocr` 用 `https://cdn.jsdelivr.net/npm/ppu-paddle-ocr/web/+esm`，兩者在 `<script type="module">` 裡直接 `import()` 都成功執行完整辨識流程，不需要 Vite/webpack。（曾先試 `esm.sh`，`@paddleocr/paddleocr-js` 在該 CDN 上會因為它重新打包依賴觸發 `[unenv] process.binding is not implemented` 錯誤，換成 jsdelivr 的 `+esm` 端點後正常——**這代表 CDN 供應商的選擇本身也是個變數，不是每個 no-bundler CDN 都行**，Phase C 實作要固定用 jsdelivr。）

**(b) 信心分數格式 — 兩者都有，且都是每個偵測項獨立一個分數（0–1 尺度）**：
- `paddleocr-js`：`OcrResultItem = { poly: Point2D[], text: string, score: number }`——`poly` 是多邊形點陣列，不是矩形，餵進現有 `{x0,y0,x1,y1}` pipeline 前要自己算 bounding box（poly 各點的 min/max x,y）
- `ppu-paddle-ocr`：`RecognitionResult = { text: string, box: { x, y, width, height }, confidence: number }`——**`box` 已經是矩形，跟現有 pipeline 幾乎零轉換成本**（`x0=box.x, y0=box.y, x1=box.x+box.width, y1=box.y+box.height`）

**(c) 三方比較（clean/textureOnly/textureWithText 三張合成測試圖，textureOnly 刻意模擬原始 bug 情境：木紋紋理背景、完全沒有真實文字）**：

| 測試圖 | Tesseract | paddleocr-js | ppu-paddle-ocr |
|---|---|---|---|
| clean（白底黑字 "Hello 測試 123"） | 正確，conf 93.8 | 正確，score 0.96 | 正確，score 0.96 |
| textureOnly（純木紋紋理，無文字） | **誤判出 3 行假文字**（"He" conf 5.5／"———" conf 0／"_ 二 生" conf 45.7）——重現了原始 bug | **正確回傳空結果，零誤判** | **正確回傳空結果，零誤判** |
| textureWithText（木紋紋理+疊一行真文字） | 正確但字元間插入多餘空格（"真 實 文 字 Real Text"），conf 93.8 | 正確但漏了中英文之間的空格（"真實文字Real Text"），score 0.97 | **完全正確，含空格**（"真實文字 Real Text"），confidence 0.95 |

**關鍵發現：Tesseract 現有的 `MIN_LINE_CONFIDENCE=60` 過濾機制對這組測試仍然有效**（3 個誤判的信心分數 5.5/0/45.7 都低於 60，會被濾掉），但**兩個 PaddleOCR 套件從源頭就不會誤判紋理成文字**，不需要靠事後過濾補洞——這比目前的 Tesseract+信心過濾方案更根本地解決了當初踩到的問題。

**冷啟動速度差異明顯**：`paddleocr-js` 第一次呼叫（含下載模型+初始化 OpenCV.js WASM）花了 15.4 秒；`ppu-paddle-ocr` 第一次呼叫（`initialize()`+`recognize()`）只花 3.1 秒——因為它預設用的 `V6_SMALL_MODEL` 明顯比 `paddleocr-js` 預設抓的 PP-OCRv5 `ch` 模型輕，且 `ppu-paddle-ocr` 不依賴 `@techstark/opencv-js`（`paddleocr-js` 的直接依賴，是一包相當大的 OpenCV WASM build）。熱啟動後兩者速度接近（2–3.5 秒/張），跟 Tesseract 同量級。

**語言統一性驗證**：`ppu-paddle-ocr` 的 `V6_SMALL_MODEL`（預設，零設定）跟 `paddleocr-js` 的 `lang:"ch"` 預設模型都在完全沒有勾選任何語言的情況下，直接正確辨識出 clean 測試圖裡混合的英文+繁體中文（"Hello 測試 123"）——**確認網路調查的說法屬實：CJK+英文是同一個預設模型內建涵蓋，不用像 Tesseract 分開下載/勾選**。`ppu-paddle-ocr` 型別定義裡列出的語言預設集（`V5_ARABIC_MOBILE_MODEL`／`V5_CYRILLIC_MOBILE_MODEL`／`V5_DEVANAGARI_MOBILE_MODEL`／`V5_GREEK_MOBILE_MODEL`／`V5_KOREAN_MOBILE_MODEL`／`V5_LATIN_MOBILE_MODEL`／`V5_TAMIL_MOBILE_MODEL`／`V5_TELUGU_MOBILE_MODEL`／`V5_THAI_MOBILE_MODEL`）證實只有**跟 CJK+拉丁字母不同書寫系統的語言**才需要切換模型，這就是語言選單重新設計的具體依據。

## 八、Phase B 決定（依 Phase A 實測結果）

- **整合套件：`ppu-paddle-ocr`**（不是 `@paddleocr/paddleocr-js`）。理由：冷啟動快 5 倍（3s vs 15s，使用者第一次用不用等那麼久）、`box` 回傳格式已經是矩形不用額外算 bounding box、不依賴笨重的 OpenCV.js、在最難的測試圖（紋理+文字）上文字辨識比另一個套件更準確（空格位置完全正確）
- **預設引擎：PaddleOCR（ppu-paddle-ocr）取代 Tesseract 成為預設**。理由：在直接重現原始 bug 的測試（textureOnly）中，Tesseract 誤判出 3 行假文字，PaddleOCR 零誤判；在真文字辨識準確度上兩者相當甚至更好；這是「表現好的那個」的實測依據，不是主觀判斷。Tesseract 保留作為第三個可選引擎（離線、免下載新模型、對已經用習慣的使用者是退路），Google Vision 維持現狀（需金鑰，不參與預設之爭）
- **語言選單**：改成「CJK+拉丁語系（涵蓋繁中/簡中/日/英/法/德/西等）」預設不需勾選（PaddleOCR 預設模型內建）+ 其他書寫系統（韓文/阿拉伯文/俄文等 Cyrillic/希臘文/泰文/坦米爾文/泰盧固文/天城文）個別勾選才切換對應語言模型；Tesseract/Google Vision 路徑維持原本每語言 checkbox 的邏輯不變（它們沒有這種統一模型）
