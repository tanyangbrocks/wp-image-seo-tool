# OCR 與疊字生成機制優化報告

*撰寫日期：2026-07-13*

## 摘要

這份報告審視兩個機制的優化空間：① OCR 文字偵測（`js/ocr-paddle.js`／`js/ocr-tesseract.js`／`js/ocr-vision.js`）② 疊字覆蓋生成（`js/main.js`／`js/color.js`／`js/html-builder.js`／`js/editor.js`／`js/preview.js`）。方法是先讀現有程式碼建立現況基準，再派兩個 agent 分別上網查 OCR 引擎現況與字體/疊字擬真技術的最新資源（不是憑印象），最後交叉比對寫成這份報告。

**最重要的結論**：這個工具實際會踩到的失敗模式（照片紋理誤判成文字、花俏字體辨識不準）**是整個 OCR 領域公開 benchmark 上仍未解決的難題**，不是換個引擎就能解決的（見下方「OCR」§0）。相對地，**疊字覆蓋生成這邊的優化空間明確得多、投報率也高得多**——尤其是「讓疊字文字寬度精準貼合 OCR 偵測框」跟「疊字字體太單一（永遠是系統無襯線字體+粗體）」這兩點，都有現成、低成本、不需要新增外部服務依賴的做法可以做。

**優先順序建議（效力／成本排序，詳細分析見各節）**：

| 順位 | 項目 | 成本 | 信心度 |
|---|---|---|---|
| 1 | 疊字文字自動貼合偵測框寬度（binary-search 字級/字距） | 低（~50-100 行，不需新依賴） | 高 |
| 2 | Google Vision 補上信心分數過濾（目前完全沒有這層防護） | 低（改 API 參數/改讀取欄位） | 高 |
| 3 | 载入 Noto Sans TC 可變字重字體，取代目前寫死的系統字體+粗體 | 低（一行 `<link>` + CSS） | 高 |
| 4 | 漸層色文字偵測＋`background-clip:text` 還原 | 中（~50-70 行，自己刻，沒有現成套件） | 中高 |
| 5 | 保留現有引擎回傳資料裡「已經有」但被我們自己丟掉的旋轉角度資訊 | 中（Vision 端是重構既有程式碼；PaddleOCR 端這個套件本身就沒給） | 中 |
| 6 | 非 ML 的粗體/襯線粗略判斷（筆畫寬度變異數分析） | 中（~150-300 行，CJK 準確度存疑） | 中 |
| 7 | 影像前處理（CLAHE 對比強化等） | 中～高（要另外評估，證據來自文件 OCR 不是行銷圖） | 低～中 |
| 8 | 多引擎信心加權合併（ensemble） | 高（架構要改成同時跑多引擎） | 中 |
| 9 | ONNX 字體分類模型（自動判斷字體家族） | 高（40-50MB 模型下載，CJK 準確度目前業界也才 ~49%） | 低 |

---

## 一、現況基準（先讀程式碼建立的事實，不是猜的）

### OCR 端

- **三引擎架構**：`recognizeWithPaddleOCR`（預設）／`recognizeWithTesseract`／`recognizeWithGoogleVision`，使用者三選一，都在瀏覽器端執行（Vision 除外，是直接從瀏覽器打 Google 的 API，用使用者自己的金鑰）。
- **信心過濾不對等**：Tesseract 有 `MIN_LINE_CONFIDENCE=60`（[js/ocr-tesseract.js:9](../js/ocr-tesseract.js)，實測校準過的門檻）、PaddleOCR 有 `MIN_CONFIDENCE_PADDLE=0.3`（[js/ocr-paddle.js:16](../js/ocr-paddle.js)）——**但 Google Vision 完全沒有信心過濾**（[js/ocr-vision.js](../js/ocr-vision.js) 整支檔案沒有讀取任何 confidence/score 欄位）。這是目前三引擎裡最明顯的不對稱缺口。
- **我們自己丟掉旋轉資訊**：`groupWordsIntoLines()`（[js/ocr-vision.js:20-29](../js/ocr-vision.js)）用 `Math.min(...xs)`／`Math.max(...xs)` 把 Google Vision 回傳的 4 點多邊形（`boundingPoly.vertices`，本來就可能是傾斜的四邊形）硬轉成軸對齊矩形——**這不是 Vision API 的限制，是我們自己的程式碼在轉換時把角度資訊丟掉**。PaddleOCR 這邊倒是套件本身（`ppu-paddle-ocr`）的 `box` 輸出格式就只有 `{x,y,width,height}`，從一開始就沒有角度資訊可保留。
- **無前處理**：三個引擎都是原圖直接餵，沒有對比強化、去噪、傾斜校正、小字放大。
- **無 ensemble**：使用者選一個引擎跑一次，沒有多引擎交叉驗證/加權合併的機制。

### 疊字覆蓋生成端

- **字級公式是純幾何估計**：`fontSizeCqw = ((y1-y0)/naturalWidth)*100*0.85`（[js/main.js:341](../js/main.js)）——完全用 OCR 框高度反推字級，`0.85` 是一個固定經驗係數，不管原圖實際字體的 x-height/cap-height 比例。
- **字體永遠寫死**：疊字文字一律用頁面全域的無襯線字體堆疊（`"Microsoft JhengHei", "PingFang TC", -apple-system, sans-serif`）＋ `font-weight:700`（粗體），不管原圖文字實際是襯線／手寫／細體／斜體。
- **顏色抽取（[js/color.js](../js/color.js)）用 Otsu 二值化＋平均色**——手法正確、對單色文字效果不錯，但只能抓「一個」平均色，沒有處理漸層填色文字、也沒有處理描邊文字。
- **字距/行距現在是手動滑桿**（本次會話剛加的功能），但**沒有自動貼合機制**——換句話說，同一個 OCR 框，套用通用字體渲染出來的文字，寬度不一定剛好等於框寬（可能溢出被 `overflow:hidden` 裁切，或撐不滿留白），使用者要自己手動調整才能貼合。
- **無漸層文字支援、無 RTL 語言方向處理**（雖然 OCR 端已支援阿拉伯文書寫系統）、**不載入任何 Web Font**（完全依賴訪客系統/瀏覽器裝的字體，跨平台外觀不一致）。
- **合併相近行**（[js/line-merge.js](../js/line-merge.js)，本次會話剛加）是純幾何門檻（垂直間距、水平重疊比例），沒有語意判斷。

---

## 二、OCR 端優化空間

### §0 最重要的背景：這個失敗模式業界都還沒解決

查到一篇 2026 年的 benchmark 論文 **HalalBench**（[arXiv 2604.22754](https://arxiv.org/abs/2604.22754)），專門針對「彎曲/低對比/多語言、印在真實包裝照片上的文字」做測試（14 種語言、1043 張圖），結果：**沒有任何一個引擎的 fuzzy-F1 超過 0.55**（ML Kit 0.487 最高、docTR 0.465、EasyOCR 0.210、RapidOCR/PaddleOCR 系 0.189 最低）。論文結論直接寫「食品包裝 OCR 仍是未解決的問題」。另一篇針對食品標籤的研究（[arXiv 2510.03570](https://arxiv.org/html/2510.03570v1)）也指出「花俏字體與小字」是所有引擎共通的失敗來源。

**這對這個工具的意義**：目前踩到的「照片紋理誤判成文字」「花俏字體辨識不準」不是這個專案獨有的 bug，是整個領域在這類內容（不是乾淨掃描文件）上的已知極限。`docs/plan-paddleocr-evaluation.md` 裡當初選 PaddleOCR 的判斷（比 Tesseract 更不容易誤判紋理）仍然合理，甚至有 Immich（自架相簿工具，同樣測過 PaddleOCR vs Tesseract 兩者後選了 PaddleOCR）當獨立佐證（[來源](http://wiss.dev/posts/guides/immich-fast-ocr-paddlex/)）。**但也要據實說明**：HalalBench 裡贏過的兩個引擎（ML Kit、docTR）都無法用在這個「純瀏覽器、無伺服器」的架構——ML Kit 是 Android/iOS 原生 SDK、docTR 沒有瀏覽器版本——所以這不是一個「換引擎就變好」的簡單優化。

### §1 值得評估的新選項：`easyocr.js`

2025-2026 出現一個新的瀏覽器 EasyOCR 移植版 `@qduc/easyocr-web`（[qduc.me/projects/easyocr](https://qduc.me/projects/easyocr/)），用跟原版 Python EasyOCR 相同的 CRAFT 偵測器＋辨識模型，跑 ONNX Runtime Web。不過前述 HalalBench 裡 EasyOCR 的分數（0.210）並沒有特別突出（雖然贏過 RapidOCR 的 0.189）。**建議**：如果要花時間評估，比照 `docs/plan-paddleocr-evaluation.md` 當初的方法論（同一組測試圖、實測比較），而不是直接假設它更好就換掉——目前證據不足以支持直接替換。

另外查到官方 PaddleOCR 現在有正式的瀏覽器 SDK `@paddleocr/paddleocr-js`（[paddleocr.ai 文件](http://www.paddleocr.ai/main/en/version3.x/deployment/browser.html)，PP-OCRv5），跟目前用的 `ppu-paddle-ocr` 是不同套件；`ppu-paddle-ocr` 本身也已經升級到 PP-OCRv6（在對應 benchmark 上 per-line 95.56%）。**這兩個資訊都需要之後再花一次 Phase A 式的實測驗證**，因為（a）目前專案版本可能沒跟到最新的 PaddleOCR 模型世代，（b）官方 SDK 是否比社群 `ppu-paddle-ocr` 更準也還沒有直接比較數據，只有查到的說法互相矛盾（見下方低信心度清單）。

### §2 立即可做、成本低的修正

1. **Google Vision 補信心過濾**：Vision API 有 `TextDetectionParams.enable_text_detection_confidence_score` 這個請求參數（[Google 官方 .NET 文件](https://docs.cloud.google.com/dotnet/docs/reference/Google.Cloud.Vision.V1/latest/Google.Cloud.Vision.V1.TextDetectionParams)），打開後 `TEXT_DETECTION` 也會回傳信心分數（預設只有 `DOCUMENT_TEXT_DETECTION` 才有）。**未完全確認**的部分：這個分數具體會落在 `fullTextAnnotation.pages[].blocks[].paragraphs[].words[].confidence`，還是也會出現在目前程式碼在用的扁平 `textAnnotations[]` 陣列——需要實際打一次 API 驗證，不能只憑文件假設。另一個選項是乾脆把 Vision 從 `TEXT_DETECTION` 換成 `DOCUMENT_TEXT_DETECTION`（Google 自己的文件說 `TEXT_DETECTION` 是設計給「標誌、標籤、零散短文字」，`DOCUMENT_TEXT_DETECTION` 是給「密集文字/段落」，這個工具的行銷圖文字其實兩種情境都有可能，值得兩種都測）。
2. **不要浪費 Vision 已經給的旋轉角度**：`groupWordsIntoLines()` 目前主動丟掉 `boundingPoly` 的角度資訊。如果之後要做「旋轉文字」支援（見下方疊字端 §建議 5），Vision 這邊完全不需要換引擎或加依賴，只是重構現有的座標轉換邏輯，保留 4 個頂點而不是塌縮成矩形。

---

## 三、疊字覆蓋生成端優化空間（investment/report 重點，機會比 OCR 端明確）

### §1 【最高信心、最低成本】自動貼合文字寬度到偵測框

現況：字級公式是「用框高度回推」，但**沒有任何機制確保渲染出來的文字寬度貼合框寬**——所以常有溢出被裁掉，或撐不滿留白的情況（這也是使用者這次會話新增字距滑桿的原因，但目前要手動調）。

查到的技術是標準、成熟做法：用 `canvas.measureText()` 量測目標字串在候選字級下的實際寬度，binary search 字級（和/或字距），直到量出來的寬度貼近 OCR 框寬。找到一份可直接參考的最小實作（[gist](https://gist.github.com/TarVK/9b81f9540754b676945ff23d1178501f)，~30-50 行，從 256px 開始每次減半逼近，用 `canvas.measureText()` 驗證），也有既有套件 **textFit**（[github.com/STRML/textFit](https://github.com/STRML/textFit)）用同樣手法多年。**這是這份報告裡信心度最高、成本最低、直接解決現有痛點的一項**，不需要任何新的 CDN 依賴（`canvas.measureText` 是瀏覽器原生 API）。

順便找到一個真的做過同類事情的實例可以參考：**Immich**（自架相簿工具）的 OCR 疊字功能（[PR #26678](https://github.com/immich-app/immich/pull/26678)）用的正是 `measureText` 貼合字級（不是用字元數估算），而且會在畫面 resize/縮放時重新計算疊字位置，垂直 CJK 文字用 `writing-mode: vertical-rl`——這幾點都直接對應這個工具可能會遇到的問題，值得直接讀那支 PR 的實作細節。

### §2 【高信心、低成本】換掉寫死的系統字體堆疊

現況：`font-family` 永遠是頁面全域堆疊、`font-weight` 永遠 `700`，不管原圖字體長怎樣。

**建議**：改用 Google Fonts CDN 載入 **Noto Sans TC**（可變字重字體，SIL OFL 授權，繁中+拉丁字覆蓋完整）。查到的資料顯示：如果自己下載整包可變字重字體再自架，檔案可能到 4.5～9MB（[來源](https://font-converters.com/)），但**用 Google Fonts 自己的 `<link>` CDN 網址就不會有這個問題**——Google 的 CDN 會依實際用到的字元自動切割子集（只送真的用到的字符），這是這個工具目前完全沒用到的免費午餐。搭配 `font-variation-settings: 'wght' <N>` 可以讓字重從固定的「粗體/不粗體」二選一，變成連續數值——之後如果做了 §5 的粗細判斷，可以直接餵一個連續的估計字重進去，不用只能二選一。這項改動幾乎是純 CSS + 一行 `<link>`，沒有 JS 邏輯要寫。

### §3 【中高信心】漸層色文字偵測＋還原

現況：`js/color.js` 只能抽出一個平均色，漸層填色的文字（不少行銷設計會用）目前只會被當成單色處理，顏色抽起來是漸層色的「平均值」，會偏離視覺上的任一端顏色。

查證結果：**這是一個確認過「沒有現成套件/技術文章」的項目**——研究 agent 直接搜尋沒找到任何現成方案，需要自己刻。但技術本身不難：延伸現有的 Otsu 取樣邏輯，改成在文字框內橫向取樣多個 x 位置的顏色，檢查是否有平滑漸變（vs. 現在只看深淺兩群），偵測到漸層就改用 `background-clip:text` + `linear-gradient()` + `color:transparent`（[參考文章](https://fossheim.io/writing/posts/css-text-gradient/)）餵入取樣到的 2-3 個顏色當漸層端點。抓不到漸層的情況（多數文字）就照舊走現有的單色路徑。這項不需要新依賴，純粹是延伸現有的像素取樣程式碼＋一段 CSS 生成邏輯。

### §4 【中信心】自動判斷粗細/襯線（非 ML 啟發式）

如果想再進一步讓字重/字型分類更貼近原圖（而不是只靠使用者手動調），查到的做法是筆畫寬度變換（Stroke Width Transform）分析——把文字區域二值化、抽骨架、算每個骨架點到邊界的距離，統計筆畫寬度的平均值跟變異數：變異數低+寬度相對字高比例高 → 偏粗體；變異數高 → 可能不是乾淨的文字或混合字重。原理文獻：[Detecting Text in Natural Scenes with Stroke Width Transform](https://www.academia.edu/7905354/Detecting_Text_in_Natural_Scenes_with_Stroke_Width_Transform)。

**重要保留意見**：查到的資料明確指出這套分析對中文字特別不準——中文字筆畫數從 1 畫到 60+ 畫變化極大，針對拉丁字母 x-height/筆畫比調的門檻，套在中文字上很可能失準。實際查到一個專門做「CJK 字體辨識」的開源模型 **YuzuMarker.FontDetection**（[GitHub](https://github.com/JeffersonQin/YuzuMarker.FontDetection)），準確率也只有 48.99%——這從側面印證中文字體/粗細分類本身就比拉丁字母難得多。考量到這個工具主要使用族群是台灣繁中使用者，**這項的實際效益存在真實的不確定性，建議列為「值得做但先設定較低的準確度期待」**，而不是當成穩贏的優化。

### §5 值得記錄但暫緩的方向

- **旋轉文字支援**：Google Vision 的 `boundingPoly` 本來就是可以傾斜的四邊形（見 OCR 端 §2），如果之後真的要支援旋轉文字疊字，資料來源已經有了，缺的是疊字端把「軸對齊矩形」的資料模型（`leftPct/topPct/widthPct/heightPct`）擴充成支援一個旋轉角度，並在 `html-builder.js`／`editor.js`／`preview.js` 三處渲染都加上 `transform: rotate(...)`。這是一個貫穿多個檔案的中型重構，不建議跟這次的小優化一起做。
- **ONNX 字體分類模型**（自動判斷字體家族）：查到兩個現成、MIT 授權、已經是 ONNX 格式的模型（`storia/font-classify-onnx`、`gaborcselle/font-identifier`），技術上可行，但需要載入 `onnxruntime-web`（額外的 WASM runtime）+ 一次性下載 40-50MB 模型檔——對一個標榜「零建置、輕量」的工具來說是很重的代價，而且都是針對拉丁字體訓練的（前述 CJK 專用模型準確率才 49%），對這個工具最常見的中文行銷圖幫助有限。**不建議近期投入**，除非之後方向明確轉向以英文行銷圖為主。
- **多引擎 ensemble 加權合併**：業界有成熟做法（信心分數正規化後加權投票），但要讓這個工具真的採用，代表使用者上傳一張圖要同時跑兩三個引擎（增加等待時間/頻寬），跟目前「使用者自己選一個引擎」的簡單模型衝突。列為長期方向，不建議近期投入。

---

## 四、引用來源清單（依報告出現順序）

- HalalBench（食品包裝 OCR benchmark）：https://arxiv.org/abs/2604.22754
- 食品標籤 OCR 比較研究：https://arxiv.org/html/2510.03570v1
- Immich 選用 PaddleOCR 的實測記錄：http://wiss.dev/posts/guides/immich-fast-ocr-paddlex/
- Immich OCR 疊字功能 PR（`measureText` 貼合＋CJK 直書）：https://github.com/immich-app/immich/pull/26678
- `easyocr.js`（EasyOCR 瀏覽器移植版）：https://qduc.me/projects/easyocr/
- 官方 PaddleOCR 瀏覽器 SDK 文件：http://www.paddleocr.ai/main/en/version3.x/deployment/browser.html
- Google Vision `enable_text_detection_confidence_score` 參數：https://docs.cloud.google.com/dotnet/docs/reference/Google.Cloud.Vision.V1/latest/Google.Cloud.Vision.V1.TextDetectionParams
- Google Vision OCR 使用情境說明（TEXT_DETECTION vs DOCUMENT_TEXT_DETECTION）：https://docs.cloud.google.com/vision/docs/ocr
- 文字自動貼合框寬 binary-search 參考實作：https://gist.github.com/TarVK/9b81f9540754b676945ff23d1178501f
- textFit（既有的貼合字級套件）：https://github.com/STRML/textFit
- CSS 漸層文字技巧：https://fossheim.io/writing/posts/css-text-gradient/
- CJK 字體檔案大小資料：https://font-converters.com/
- Stroke Width Transform 論文：https://www.academia.edu/7905354/Detecting_Text_in_Natural_Scenes_with_Stroke_Width_Transform
- YuzuMarker.FontDetection（CJK 字體辨識模型，48.99% 準確率）：https://github.com/JeffersonQin/YuzuMarker.FontDetection
- storia/font-classify-onnx：https://huggingface.co/storia/font-classify-onnx
- gaborcselle/font-identifier：https://huggingface.co/gaborcselle/font-identifier

## 五、待確認事項（agent 查到但沒把握，之後真的要動工前建議先驗證）

- Google Vision `enable_text_detection_confidence_score` 打開後，信心分數究竟會出現在 `fullTextAnnotation` 巢狀結構、還是也會出現在目前程式碼在用的扁平 `textAnnotations[]` 陣列——文件沒寫清楚，需要實際打一次 API 驗證。
- `@paddleocr/paddleocr-js`（官方 SDK）跟目前用的 `ppu-paddle-ocr`（社群套件）誰的辨識準確度真的比較高——兩邊查到的說法互相矛盾，需要重跑一次 `docs/plan-paddleocr-evaluation.md` 那種 Phase A 實測才能下結論。
- Tesseract.js 的 `baseline`/`rowAttributes` 欄位（可能跟旋轉文字偵測有關）的實際資料結構——agent 沒能從原始碼直接確認，只查到間接引用。
