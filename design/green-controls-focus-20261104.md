# 綠色操作色與選取邊界修正

日期：2026-11-04。延續既有正式介面，調整按鈕、原生表單控制、選項、勾選框、人物、查詢端點與全圖導覽的操作／選取色。

## 色彩與顯示規則

- 主要操作 `#346747`，按下 `#285238`，焦點 `#245b3c`，選取底 `#edf5ee`，淡綠邊線 `#bfd5c5`。原生 radio／range 等沿用綠色 `accent-color`。
- 白底主要綠色文字的對比值為 6.61:1，白底焦點綠為 7.96:1，淡綠選取底上的主要綠為 5.95:1。這些數值只代表指定實色配對。
- 焦點框在控制項內側繪製；實色主要按鈕與已勾選的 checkbox 採內嵌白色焦點框。人物選取、雲端版本選取與查詢端點的標示也保留在控制項範圍內。
- 全圖導覽的視窗與選取框使用綠色；SVG 可在自身邊界繪製筆畫，外層仍保留留白。世代色帶與親屬線的語意配色保留，查詢兩端仍可區分角色。

## 重現與修正的遮擋

1. 手機家族標題：原本 2px、向外 3px 的焦點框完全落在標題的裁切區外。基準截圖與量測在 `.codebase-memory/phase5-results/green-focus-baseline/`。
2. 桌面人物詳情：返回按鈕的負邊距使按鈕左側超出內容裁切邊界。移除負邊距，保留完整按鈕與描邊。
3. 窄手機人物定位：320×568 的原本詳情高度使人物上下邊界超出可讀畫布，「看全圖」還會蓋住人物右側。手機「看全圖」改放工具列，重用原本按鈕及事件，畫布內不再有這個遮擋來源。窄工具列自動分成兩列；瀏覽面板依工作區與人物卡的實際高度保留空間。完整閱讀及拖曳仍有自己的高度範圍。定位人物時亦避開世代標籤與全圖導覽，保留使用者的縮放倍率。
4. 世代標籤：這個圖層不攔截點擊，但仍會遮住人物描邊。因此定位也保留標籤色帶的實際寬度，並以截圖像素驗證。
5. 查詢端點：操作說明浮層會覆蓋查詢人物。查詢期間暫時收起該說明，離開查詢後恢復原本入口。
6. 橫向成員清單：焦點列可能被固定搜尋／篩選列遮住。依固定列實際高度設定 scroll padding，讓原生聚焦及捲動保留可見空間。
7. 地圖縮放：上下按鈕各自使用與容器相符的圓角與內側焦點框。

## 驗證方法

新增 `tests/browser-green-focus.cjs`，使用隔離 fixture 及 API／靜態儲存模式。每種模式測試 1440×900、1024×768、390×844、320×568、844×390。

每個場景實際聚焦控制項，等待原生聚焦捲動與 sticky layout 完成後，從瀏覽器 PNG 取樣描邊的左、右、上、下四側，並檢查五個點擊位置是否被其他元素覆蓋。像素座標會套用畫布實際縮放；只讀 computed style 無法證明描邊有畫出來。

涵蓋工具列、縮放／全圖導覽、清單搜尋與篩選及首末列、人物選取、詳情導覽、橫向關係分類、更多操作、完整閱讀與返回、成員及關係表單、選填欄位與 checkbox、全域更多、關係查詢及端點、地圖控制、匯入底列與圖譜輸出。每個情境亦核對沒有 JavaScript 錯誤及資料變更。

既有地點修正測試另有舊文案假設：原先期待「其他 2 位」及無文字圖示，但目前正式介面使用「其他 2 人」、「搜尋地點」、「地圖指定」和「使用此位置」。第一個失敗已在未修改的 HEAD 重現，紀錄在 `.codebase-memory/phase5-results/green-controls-baseline/`；本輪調整測試符合既有文案，保留圖示數、無障礙名稱、觸控尺寸、快取、定位、復原與儲存斷言。

`harness/config.json` 仍是未設定的 harness 範本；驗證使用實際應用測試，未用 harness 自我測試代替。

## 執行紀錄

Windows Node v24.22.1、Edge／Playwright。完整的本輪相關回歸選擇如下（並非所有專案 suites）：

```powershell
$env:PLAYWRIGHT_MODULE='C:\Users\bluef\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
$env:GREEN_FOCUS_OUTPUT='.codebase-memory/phase5-results/green-final-toolbar-20261104/focus'
$env:PHASE5_SUITE_FILTER='^(unit|browser-(green-focus|button-layout|action-layout|apple-workflows|ui-improvements|map-workspace|location-corrections|select-scroll|phase3|phase4|canvas-motion)\.cjs|build|release-package)$'
$env:PHASE5_OUTPUT_DIR='.codebase-memory/phase5-results/green-final-toolbar-20261104'
node tests/run-phase5.cjs
```

正式程式固定後，最終 **14 組皆通過**，包含 **284 項 Node 測試**、10 個 API／靜態畫面情境的 **1,037 次四邊描邊／點擊遮擋檢查**、清單與表單、查詢、畫布動態、地點修正、地圖、詳情、輸出、下拉選單捲動、建置及發布包檢查。`report.json` 的 `runtimeUnchanged`、`fixtureUnchanged`、`automatedPassed` 均為 true。

最終報告位於 `.codebase-memory/phase5-results/green-final-toolbar-20261104/report.json`；描邊報告、逐情境截圖在同目錄的 `focus/`，逐需求證據與正式檔案 SHA-256 在 `acceptance.json`。檢查也涵蓋詳情瀏覽之後的人物選取、原生 `select` 及匯出設定的 input／select。開發過程的通過與失敗紀錄均保留。

## 範圍與限制

驗證針對上述視窗尺寸與可重現的操作狀態；一般捲動畫布超出視窗、主動縮放超過可見範圍，以及完整閱讀時刻意隔離背景，屬於既有操作行為。實體手機、真實螢幕鍵盤、VoiceOver 與真實 Google Drive 帳號尚未驗證，未發布網站。
