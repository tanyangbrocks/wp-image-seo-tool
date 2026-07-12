# Completed Milestones History

Auto-archived from C:\wp-image-seo-tool\實作進度.md by docs/archive-done.ps1.

| 功能 | 關鍵檔案 | 摘要 |
|------|---------|------|
| 建立專案治理檔案 + GitHub repo + Vercel 部署 | `CLAUDE.md`、`.gitignore`、`docs/archive-done.ps1`、`實作進度.md` | 依照 Portfolio / SkillCreatorUE5 兩個既有專案的工作慣例補齊：`CLAUDE.md` 記錄「單檔架構是刻意選擇、什麼情況才該拆檔」的判斷原則、🔴 API 金鑰絕對不能寫死進程式碼的安全規則（這個 repo 跟 Vercel 部署都公開）、核心 OCR/顏色萃取邏輯摘要、`DataTransfer` 測試技巧；`.gitignore` 排除 OS/編輯器暫存檔、`.vercel`、未來若加建置工具需要的 `node_modules`/`.env*`；`docs/archive-done.ps1` 從 Portfolio 專案原封不動複製（腳本本身完全通用，不綁定特定專案路徑）。新建 GitHub repo `tanyangbrocks/wp-image-seo-tool`，本地 `C:\wp-image-seo-tool\` push 上去；使用者自行完成 Vercel Import from GitHub 設定。 |
