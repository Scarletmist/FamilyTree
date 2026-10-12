# 第四階段後索引

日期：2026-10-11 至 2026-10-12，專案 `D-FamilyTree`，Verify 層級。

- 修改前快照：`before-phase4.graph.db.zst`，承接推導徽章版本（2580 nodes／8001 edges）。
- 完成後執行 full、persistent 索引：2672 nodes／8460 edges，寫入 `graph.db.zst` 及 `artifact.json`。
- 結構探索使用 renderTree／beforeRender／relationshipMemberIds／build 的 search_graph、trace_path、get_code_snippet，並補讀實際畫布、viewport、工具列、CSS、列印及測試接點。
- 共 39 個依據路徑的 coverage 結果保存為 `coverage-phase4-20261011.json`，全數返回，沒有截斷。
- `family-workspace.css` 第 91、92、158 行仍為 partial parse；已直接讀取這些 CSS 原文。全部路徑於 full reindex 後仍回報 metadata_changed，因此結論另以本次撰寫／核對的原始碼、建置、瀏覽器及實際輸出驗證支持；ready 不代表完整覆蓋。
- `.codebase-memory`、dist、vendor、套件依賴與圖像等仍按原排除規則處理。本次未改排除規則或修復既有 CSS parser 問題。

正式模組与驗證見 `design/phase4-implementation-20261011.md`。前一至三階段的快照與紀錄保留。
