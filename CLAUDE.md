# WP Image SEO Tool — Claude Code 工作規則

## 專案概要

單一靜態網頁工具：把 AI 生成、本身已畫有文字的圖片，OCR 辨識出文字的**內容、位置、大小、實際顏色**，還原成疊在圖片上的真 HTML 文字（可被選取、可被搜尋引擎索引），使用者只需要填 Alt 描述，其餘全自動處理，產生可直接貼進 WordPress「自訂 HTML」區塊的內容。

**GitHub**：https://github.com/tanyangbrocks/wp-image-seo-tool.git
**本地路徑**：`C:\wp-image-seo-tool\`
**部署**：Vercel，零設定靜態網站（無建置流程，Build Command 留空，Root Directory `./`）

---

## 架構現況與判斷原則

目前是**單一 `index.html`**（HTML/CSS/JS 全部寫在一起，~500 行），這是刻意的選擇，不是還沒整理：
- 原始需求是「單檔、雙擊即可用、不需要建置」，拆成多檔案通常代表要引入 bundler（Vite/esbuild）把檔案重新打包成一個，對這個規模的專案是不對等的複雜度投資
- 現有程式碼已經用具名函式做內部分工（`otsuThreshold`／`extractTextColor`／`groupWordsIntoLines`／`recognizeWithGoogleVision`／`renderPreview`／`buildFinalHtml`），可讀性不是問題

**什麼時候該重新考慮拆檔/引入建置工具**：功能明顯變複雜到單檔難以維護時再拆，例如：新增多個 OCR 引擎選項互相切換、批次處理多張圖片、可視化調整疊字樣式的進階編輯介面。不要在還沒到這個門檻前主動拆檔案。

**CLAUDE、gitignore 這類專案治理檔案**跟上面的「程式碼要不要拆檔」是兩回事——前者幾乎零成本、隨時該補齊；後者才需要衡量門檻，不要混為一談。

## 🔴 安全規則：API 金鑰絕對不能寫死進程式碼

「進階設定」讓使用者可以選填自己的 Google Cloud Vision API 金鑰以提升辨識準確度。**這把金鑰只存在使用者自己瀏覽器的 localStorage，透過瀏覽器直接打 Google 的 API**——絕對不要把任何金鑰（不管是誰的、不管是不是「先暫時測試用」）寫進 `index.html` 原始碼或 commit 進 git，這個工具是公開部署在 Vercel 上、原始碼也公開在 GitHub，寫死的金鑰等於直接外洩。

金鑰欄位是 `type="password"`，`.gitignore` 已經排除 `.env*`，但**這個工具目前不使用任何伺服器端環境變數**——Vercel 專案的 Environment Variables 設定應保持空白，不要因為「方便測試」加任何金鑰進去。

## 核心邏輯摘要（修改前先讀這段，不要憑空猜測行為）

1. 使用者上傳圖片 → 讀取 natural width/height，畫進 offscreen canvas 供後續像素取樣
2. OCR 辨識：預設 Tesseract.js（`chi_tra+eng`，CDN 載入，離線可用但辨識力對花俏字體較弱）；若使用者勾選進階設定並填了金鑰，改打 Google Cloud Vision `TEXT_DETECTION`，失敗時自動退回 Tesseract（不會讓整個流程卡死）
3. Google Vision 回傳的是逐字座標，`groupWordsIntoLines()` 依 Y 座標鄰近程度群組成行，模擬 Tesseract 原生就有的 `data.lines` 結構，讓兩個引擎共用同一套下游處理
4. 每一行偵測到的文字都會用 `extractTextColor()` 抓真實顏色：用 Otsu 閾值法把框框內像素分兩群（假設面積較小的那群是文字本身），平均該群的**原始 RGB**（不是只判斷黑白）
5. 位置/大小用**百分比**（相對圖片 natural width/height）+ CSS `container-type: inline-size` 搭配 `cqw` 單位做字級，確保疊字在圖片被縮放時仍維持正確比例
6. Alt 欄位留空時不產生輸出；使用者一輸入 Alt，`updateOutput()` 就即時（不用按鈕）重新產生完整可複製貼上的 HTML

## 測試方式

沒有測試框架，用 preview 工具手動驗證。**原生檔案選擇對話框無法被自動化工具觸發**，測試上傳圖片流程要用這個模式：

```js
const resp = await fetch('/test-image.png');
const blob = await resp.blob();
const file = new File([blob], 'test.png', { type: 'image/png' });
const dt = new DataTransfer();
dt.items.add(file);
const input = document.getElementById('imageInput');
input.files = dt.files;
input.dispatchEvent(new Event('change', { bubbles: true }));
```

改完程式碼後至少要驗證：OCR 辨識結果、位置/顏色計算、Alt 空白時不出 HTML／填了立即出 HTML、複製按鈕、（如果有動到雲端辨識邏輯）金鑰錯誤時能正確 fallback 回離線引擎且不影響最終結果。

## 待辦 / 未來方向

- [ ] 使用者提供真的 Google Cloud Vision API 金鑰做一次實測（目前只驗證過請求格式正確 + 錯誤金鑰的 fallback 行為，沒驗證過金鑰正確時辨識結果的實際品質）
- [ ] 使用者可能想加使用教學（未來可能開一個 `docs/` 資料夾放教學內容/截圖）
- [ ] 使用者可能想擴充 UI 介面（在單檔規模允許的前提下）
