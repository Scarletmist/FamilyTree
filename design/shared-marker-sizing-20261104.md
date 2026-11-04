# 共線關係端點符號尺寸修正

## 問題與原因

多條關係共用路徑時，`renderDiagram()` 會把重疊線段拆成不重疊的區間，再獨立重建各個關係端點的符號。SVG marker 使用預設的 `strokeWidth` 單位；重建的短路徑未指定線寬，採用預設值 1，與一般關係線的 2／2.5／3 不同，造成圓形、方形、菱形及箭頭等端點縮小。

修正位於 `src/assets/family-tree-diagram.mjs`：獨立端點路徑帶回該關係的原始線寬，與未共線的關係使用相同尺寸。這個修正套用在共用的端點重建流程，保留既有線路、方向、來源、選取及可見性資訊；輸出的 SVG 也會保存此線寬。

## 重現與測量

`tests/browser-shared-markers.cjs` 使用隔離測試資料，包含師兄弟姊妹、手足、契手足、堂親與師徒的共線群組，以及各類型的普通關係線作為參考。API／靜態模式各測試桌面 1440×900、手機 390×900。

- 檢查共線端點的實際線寬與一般線一致。
- 將真正的 marker 與一般線端點分別光柵化，在 0.5、1、2 倍比例比較符號的實際像素寬高；排除短承載路徑本身的筆端與虛線像素，單獨測量符號。
- 檢查序列化 SVG 仍保存所有端點的正確線寬。
- 檢查沒有 JavaScript 錯誤，且家族資料保持不變。

修正前的重現保存在 `.codebase-memory/phase5-results/shared-markers-reproduced-20261104/`，例如堂親的共線端點線寬為 1，普通線為 2.5，斷言失敗。初始光柵測試曾將承載線的 round cap 算入符號範圍，造成 1 像素差異；已將測量限定為符號本身，保留先前輸出。早期未建立排行群組的測試資料未觸發所有同輩共線群組，其探索輸出亦保留。

## 驗證命令

Windows、Node v24.22.1、Edge／Playwright：

```powershell
$env:PLAYWRIGHT_MODULE='C:\Users\bluef\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
$env:PHASE5_SUITE_FILTER='^(unit|browser-(shared-markers|sharing|peer-sharing|mixed-sharing|family-inference|phase4)\.cjs|build|release-package)$'
$env:PHASE5_OUTPUT_DIR='.codebase-memory/phase5-results/shared-markers-final-20261104'
$env:SHARED_MARKERS_OUTPUT='.codebase-memory/phase5-results/shared-markers-final-20261104/markers'
node tests/run-phase5.cjs
```

最終 **9 組相關驗證全數通過**，包含 284 項單元測試、新增 4 個 API／靜態桌面／手機情境的 56 個共線端點、168 次符號像素尺寸比對，以及 SVG 線寬保存檢查。既有同輩共線測試通過 144 個案例，混合來源共線通過 54 個案例。報告位於 `.codebase-memory/phase5-results/shared-markers-final-20261104/report.json`，其 `automatedPassed`、`runtimeUnchanged`、`fixtureUnchanged` 均為 true；新測量結果與截圖位於同目錄的 `markers/`。

相關測試涵蓋共用線段、不同來源群組、直接／推斷／排行關係的顯示、人物選取、補登中間人物、導航、SVG／列印輸出、建置與發布包。此為本輪相關回歸；`harness/config.json` 仍是尚未設定的範本，沒有以 harness 自我測試代替應用測試。未驗證實體手機、VoiceOver 或真實 Google Drive，未發布網站。
