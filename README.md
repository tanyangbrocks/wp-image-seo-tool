# WP Image SEO Tool

單一靜態網頁工具，把 AI 生成、本身已畫有文字的圖片，轉換成適合貼進 WordPress「自訂 HTML」區塊的內容：

- 自動 OCR 辨識圖片裡的文字，連同**位置、大小、實際顏色**一起還原成疊在圖片上的真 HTML 文字（可被選取、可被搜尋引擎索引）
- 使用者只需要填 Alt 描述，其餘全自動處理，填了 Alt 就即時產生完整 HTML
- 預設用免費、離線的 Tesseract.js 辨識；進階設定可選填自己的 Google Cloud Vision API 金鑰以提升辨識準確度（金鑰只存在使用者自己的瀏覽器，不會被寫進輸出的 HTML 或分享出去）

## 使用方式

直接開啟部署好的網址（或雙擊本機的 `index.html`），上傳圖片、打 Alt 文字、複製產生的 HTML 貼到 WordPress 即可。不需要帳號、不需要安裝任何東西（進階的雲端辨識功能除外，那個需要自己的 Google Cloud Vision API 金鑰）。

## 技術說明

純靜態 HTML/CSS/JS，沒有建置流程，沒有後端。OCR 引擎（Tesseract.js）透過 CDN 載入，圖片與辨識結果都不會上傳到任何第三方伺服器（雲端辨識模式除外，該模式下圖片會直接從使用者瀏覽器送到 Google 的 Vision API）。
