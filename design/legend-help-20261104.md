# 關係圖例與圖譜操作說明

本輪處理桌面關係圖例被畫布遮蓋，以及桌面／手機操作說明佔據畫布的問題。保留圖譜操作和家族資料功能。

## 行為調整

- 工具列建立明確的顯示層級，使展開的關係圖例位於畫布、人物及縮略圖之上。
- 圖例依視窗剩餘高度限制尺寸，固定單欄垂直捲動，避免矮視窗換成多欄後截斷內容。
- 操作說明移至「更多功能 → 圖譜操作說明」，桌面、手機直向及橫向共用此入口。首次進入和重新載入都不在畫布上常駐說明。
- 說明使用原生 modal dialog；可用關閉按鈕、「知道了」或 Escape 關閉，焦點返回原本的更多按鈕。「看全圖」和「定位人物」關閉說明後執行原有功能。

操作說明屬於偶爾查閱的輔助資訊，以需要時開啟的方式保留可發現性，讓畫布優先呈現人物與關係。

## 重現與驗證

修正前，以 `tests/browser-legend-help.cjs` 在 1440×900 桌面執行實際點擊與 hit testing，圖例的五個取樣點均被畫布或縮略圖覆蓋，斷言失敗。證據保存在 `.codebase-memory/phase5-results/legend-help-baseline/`。截圖檢視亦發現矮桌面視窗的圖例會換成被截斷的多欄，已補上水平溢位及最後一項可捲動到達的檢查。

新增測試使用隔離 fixture，在 API 與靜態儲存模式各測試 1440×900、1280×480、1024×768、390×844、320×568、844×390。檢查圖例遮擋、可視範圍、捲動、操作說明入口、modal 狀態、關閉與焦點返回、定位與看全圖、重新載入及資料不變。截圖保存在測試輸出目錄的 `legend-help/`。

執行環境：Windows、Node v24.22.1、Edge／Playwright。相關回歸命令：

```powershell
$env:PLAYWRIGHT_MODULE='C:\Users\bluef\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
$env:PHASE5_SUITE_FILTER='^(unit|browser-(legend-help|apple-workflows|canvas-motion|button-layout)\.cjs|build|release-package)$'
$env:PHASE5_OUTPUT_DIR='.codebase-memory/phase5-results/legend-help-verified-20261104'
$env:LEGEND_HELP_OUTPUT='.codebase-memory/phase5-results/legend-help-verified-20261104/legend-help'
node tests/run-phase5.cjs
```

首次相關回歸的單元測試遇到 Node fetch `bad port`，該測試以系統動態埠啟動本機伺服器；原始失敗紀錄保留於 `.codebase-memory/phase5-results/legend-help-final-20261104/unit.log`。未修改該單元測試或伺服器程式，最終一輪的 284 項單元測試通過。

最終相關回歸 **7 組全數通過**：284 項單元測試、既有 Apple 操作流程、工具列與按鈕配置、畫布動態、12 組 API／靜態圖例與說明情境、建置及發布包檢查。`report.json` 的 `automatedPassed`、`runtimeUnchanged`、`fixtureUnchanged` 均為 true。報告位於 `.codebase-memory/phase5-results/legend-help-verified-20261104/report.json`；這是本輪相關回歸，並非全部 56 組專案 suites。

`harness/config.json` 尚未設定真實專案，本輪使用實際應用測試，沒有以 harness 自我測試代替。驗證範圍為上述自動化與截圖；未執行實體 iOS／Android、VoiceOver 或真實 Google Drive 驗證，未發布網站。
