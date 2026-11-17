# P2／P3 實作與驗證紀錄

2026-11-17。P2 的兩項及 P3 的文件／驗收對接已實作；保留既有 P1 與陣列現代化變更。未提交、推送、觸發遠端 CI 或部署。

## 已實作

- 新增命令移除私有 helper 的重複完整建圖；既有 IndexedDB 遷移入口先驗證 envelope，正常讀取及 transaction 邊界仍做完整領域驗證。靜態表單直接處理命令的結構化錯誤；HTTP 開發模式保留可提供欄位上下文的預檢。
- 保留提交前驗證、最新版本衝突檢查、重試冪等、歷史、undo、dirty 與舊 snapshot 不變性。沒有引入跨操作的可變圖譜快取。
- [瀏覽器政策](browser-support.md) 訂定 Chrome／Edge 134、Firefox 136、Safari／iOS 18.3 的支援目標，固定 Playwright 1.62.1 及 lockfile。Windows 預設 Edge；CI 使用 bundled engines。
- [Validate workflow](../.github/workflows/validate.yml) 加入 Node 20／22、Chromium／Firefox／WebKit、P1 及 API／靜態 smoke；Chromium 執行效能上限檢查。[Pages](../.github/workflows/pages.yml) 必須等共用驗證成功才發布。
- [架構](architecture.md)、[驗收 P-01～P-09](acceptance_criteria.md)、[決策](decisions.md) 與 README 已改為實際應用內容。harness 設為 project_ready，對接真實 Node／browser／performance suites；adapter 拒絕零執行、缺漏結果及不完整指標。
- 修正 harness 在 Windows 的 Git 輸出解碼與 UTF-8 task bytes／hash 一致性；自測用獨立設定及資料，避免誤執行應用套件。

## 同環境前後比較

Windows x64、Node v24.22.1、Playwright 1.62.1、Edge 157.0.4341.60。每種資料形狀／規模各暖身一次，三個新的 browser context 取樣。每次檢查實際載入人數；households 每組最多 12 人，cohorts 每組最多 48 人，包含配偶及雙親記錄。不是所有可能的家族結構。

| 成員數 | 形狀 | 修改前中位數 ms | 修改後中位數 ms | 完整建圖次數 |
|---|---|---:|---:|---|
| 100 | households | 57.1 | 27.2 | 6 → 4 |
| 100 | cohorts | 308.8 | 139.0 | 6 → 4 |
| 500 | households | 409.4 | 182.8 | 6 → 4 |
| 500 | cohorts | 1351.3 | 720.6 | 6 → 4 |
| 1000 | households | 743.9 | 524.6 | 6 → 4 |
| 1000 | cohorts | 2309.4 | 1650.6 | 6 → 4 |

六組完整建圖都減少 33.3%。計時範圍是 FamilyApp 新增 → 命令／儲存 → 狀態採用，不包含畫布 DOM、呈現延遲及使用者輸入等待；毫秒數為同機 lab 觀察，不能宣稱網站 INP 或真機速度。採用門檻是建圖最多四次、不得退步及功能測試通過。

有效比較：[comparison](../harness/experiments/modern-web-p2-20261117-v3/comparisons/comparison-39e12695fba0.json)，eligible=true。原始逐筆取樣、載入人數、來源 SHA-256、版本見 [before](../harness/experiments/modern-web-p2-20261117-v3/performance-before.json)／[after](../harness/experiments/modern-web-p2-20261117-v3/performance-after.json)。

## 驗證結果

| 檢查 | 實際結果 |
|---|---|
| Node regression | 289 通過，0 失敗 |
| Edge 157.0.4341.60 | 15 個 P1 + 8 個 API／靜態 UI 情境通過 |
| Firefox 153.0 | 同樣 23 個情境通過 |
| WebKit 26.5 | 同樣 23 個情境通過 |
| 最終命令管線 | 六組資料 × 三次取樣通過；外加建圖上限共 7 checks，最大值 4 |
| 額外關係政策 | API、靜態關係流程及模擬雲端衝突三個 PASS 摘要 |
| Harness 自測 | 49 項列入，其中 48 執行通過、1 skipped；與應用驗收分開 |
| build／check-release | 通過；63 files，browser storage，無 fixtures，相對資源 |
| Workflow YAML／git diff --check | 本機結構解析與空白檢查通過；遠端 Actions 尚未執行 |

最終檔案狀態的 [harness report](../harness/experiments/modern-web-p2-final-20261117/runs/final-2ed7060b97ac/report.json) 包含 289／23／7 checks、退出碼及指紋。跨引擎、額外回歸、發布檢查的原始 log 在本次工作區 artifact 目錄 `p2-firefox-candidate.log`、`p2-webkit-candidate.log`、`p2-relationship-final.log`、`p2-build-release.log`、`p2-harness-selftests.log`。

## 保留的失敗與量測限制

最初實驗的 Windows task 換行造成 hash 不一致，未取得有效比較。v2 的極簡測試頁未宣告 UTF-8，且沒有驗證載入成員數，可能回落空資料；v2 全部數字作廢、保留證據，不作採用依據。v3 修正編碼，增加每次載入大小與 adapter 的獨立檢查後，重新取得真正的基準及候選。

跨引擎準備時曾遇到載入／對話框動畫未就緒；改為明確等待 App、畫布與開啟動畫後，完整情境通過。額外關係測試原先在靜態非同步驗證完成前立即讀錯誤，失敗 log 保留於 `p2-relationship-regression.log`；只加上等待預期錯誤的隔離診斷通過後，再修改原測試，原有 assertion 全數保留。因 evaluator 變更，另開 final experiment；v3 的凍結前後比較未被覆寫。

本機只有 Node24 的執行結果；Node20／22 Linux CI 是已設定、尚未遠端執行。支援目標的最低版本、iOS／Android 實機、VoiceOver／NVDA／Narrator、真實 OAuth／Drive 尚未驗收。WebKit 自動化不代表實體 iPhone Safari。真實輸入與渲染效能仍需另行量測。

## 重現

```sh
npm ci --ignore-scripts
npx playwright install chromium firefox webkit
npm run validate:unit
npm run test:smoke:browser
npm run test:performance
npm run build
npm run check:release
```

以 PLAYWRIGHT_ENGINE 選擇引擎；PowerShell 設定例子及本機 Edge／bundled 選擇見 browser-support。harness 的任何新 evaluator／驗收變更都須新建 experiment，不重用已凍結的 v3 或 final。

Modern Web Guidance 本次使用 identify-inp-causes 區分資料管線與渲染成本；依其「Lab data only replicates a small subset of real user scenarios」，沒有將 lab 時間標示為 INP，也沒有新增 RUM 傳輸。
