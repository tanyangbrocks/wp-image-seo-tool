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

## 五、待確認事項

1. **要評估哪一個套件**：官方 `@paddleocr/paddleocr-js`（較新、官方維護但版本號還很低 0.4.x，可能還不夠穩定）還是社群的 `ppu-paddle-ocr`（版本號較高 v6、社群評價聽起來成熟，但非官方）？還是兩個都花時間各自做一次小規模實測比較？
2. **PaddleOCR 若實測準確度確實更好，要整個取代 Tesseract，還是並列成第三個選項**（跟 Google Vision 一樣，使用者自己選）？並列會讓 UI 更複雜（三選一而不是二選一），但保留 Tesseract 當保底選項，萬一 PaddleOCR 在某些圖片上表現不如預期還有退路
3. **要不要順便重新設計語言選單**：如果繁中/簡中/英/日真的是同一個模型內建涵蓋、不用分開勾選下載，現有「勾選語言」這個 UI 概念可能要跟著調整（可能只需要「東亞語言 on/off」+「其他語言個別勾選」這種分組，而不是現在每個語言各自一個 checkbox）

## 六、分階段實作步驟

- [ ] Phase A — 小規模技術驗證（spike，非正式串接）：分別試裝 `@paddleocr/paddleocr-js` 跟 `ppu-paddle-ocr`，確認（a）能不能用 CDN `<script>` 標籤 + 全域變數的方式在無建置流程的單檔 HTML 裡運作，（b）`predict()`/辨識結果是否真的回傳每個偵測框的信心分數、格式長怎樣，（c）拿目前這個 repo 已經用過的測試圖（乾淨文字圖、雜訊背景圖）實際跑一次，比較跟 Tesseract 的辨識結果差異
- [ ] Phase B — 依 Phase A 結果 + 使用者對「五、待確認事項」的回覆，決定要不要正式整合、整合哪一個套件、取代還是並列
- [ ] Phase C（如果決定整合）— 仿照 `recognizeWithGoogleVision()` 的模式寫一個 `recognizeWithPaddleOCR()`，輸出同樣的 `[{text,x0,y0,x1,y1}]` 格式餵進現有下游 pipeline；如果套件本身有信心分數，一併輸出，讓 `MIN_LINE_CONFIDENCE` 式的過濾邏輯可以套用
- [ ] Phase D — 驗證：用現有的回歸測試圖（乾淨黑白字、彩色字、雜訊背景圖）跑過一輪，確認新引擎至少不比 Tesseract 差；`npm run build`（如果引入建置流程的話才有這步）/單檔情境下確認 `index.html` 仍能直接雙擊本機開啟或部署到 Vercel 後正常運作
