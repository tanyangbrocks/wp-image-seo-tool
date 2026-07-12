# Completed Milestones History

Auto-archived from C:\wp-image-seo-tool\實作進度.md by docs/archive-done.ps1.

| 功能 | 關鍵檔案 | 摘要 |
|------|---------|------|
| 建立專案治理檔案 + GitHub repo + Vercel 部署 | `CLAUDE.md`、`.gitignore`、`docs/archive-done.ps1`、`實作進度.md` | 依照 Portfolio / SkillCreatorUE5 兩個既有專案的工作慣例補齊：`CLAUDE.md` 記錄「單檔架構是刻意選擇、什麼情況才該拆檔」的判斷原則、🔴 API 金鑰絕對不能寫死進程式碼的安全規則（這個 repo 跟 Vercel 部署都公開）、核心 OCR/顏色萃取邏輯摘要、`DataTransfer` 測試技巧；`.gitignore` 排除 OS/編輯器暫存檔、`.vercel`、未來若加建置工具需要的 `node_modules`/`.env*`；`docs/archive-done.ps1` 從 Portfolio 專案原封不動複製（腳本本身完全通用，不綁定特定專案路徑）。新建 GitHub repo `tanyangbrocks/wp-image-seo-tool`，本地 `C:\wp-image-seo-tool\` push 上去；使用者自行完成 Vercel Import from GitHub 設定。 |
| 建立核心工具：OCR 文字位置/顏色還原 + Alt 驅動的即時 HTML 產生器 | `index.html` | 上傳圖片後用 Tesseract.js（`chi_tra+eng`）辨識文字內容與每一行的邊界框；用 Otsu 閾值法把框內像素分兩群（面積較小的一群視為文字本身），取該群**原始 RGB 平均色**還原文字真實顏色（不是只判斷黑白）；位置/大小換算成相對圖片 natural width/height 的百分比，字級用 CSS `container-type: inline-size` + `cqw` 單位維持縮放時的正確比例。Alt 欄位留空時不產生輸出，一填就即時（`input` 事件，非按鈕觸發）重新產生完整 HTML，複製貼上即可用。**進階設定**：使用者可選填自己的 Google Cloud Vision API 金鑰改走雲端辨識（`groupWordsIntoLines()` 把 Vision 回傳的逐字座標依 Y 座標鄰近度群組成行，模擬 Tesseract 原生的行結構，兩引擎共用同一套下游位置/顏色處理），金鑰錯誤或請求失敗時自動 fallback 回離線引擎；「記住金鑰」勾選後存本機 localStorage，不會外流。**驗證方式**：preview 工具用 `DataTransfer` + 手動 `dispatchEvent('change')` 模擬真實檔案上傳（原生檔案選擇對話框無法被自動化工具觸發），先後測試黑白文字圖與彩色文字圖（藍底紅字），確認辨識文字、位置百分比、顏色萃取（`rgb(230,40,40)` 原色抓出 `rgb(192,44,70)`，同色系）、Alt 即時產生/清空即消失、HTML 特殊字元跳脫（`"`/`<`/`>`/`&`）、複製按鈕都正確；用假金鑰測試確認 Google Vision 請求真的送達 Google 伺服器（收到結構化 400，非網路層級失敗）且正確 fallback，行為跟原本離線模式一致（回歸測試）。 |
