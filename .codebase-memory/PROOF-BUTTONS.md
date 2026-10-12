# 關係按鈕調整後索引

日期：2026-10-11。專案 `D-FamilyTree`，full／persistent，狀態 indexed。

- 修改前快照為 `before-proof-button-dedup.graph.db.zst`。
- 完成後索引包含 2579 個節點、8010 條關係。
- 核對 17 個來源、測試及文件路徑，分頁完整；診斷為 `coverage-proof-buttons-20261011.json`。
- `family-workspace.css` 第 91、92、158 行 partial parse 以直接來源補查；所有指定路徑 metadata_changed 亦以實際來源與測試補核，索引不是完整性保證。

沿用 Verify 流程查詢 buildGroups／open／render 等接點。結果為每位親屬一個來源入口，以及來源／補填共用操作列；父母完整的堂表親仍省略額外連線。209 項 Node 測試、八個瀏覽器 context、建置及 whitespace 檢查通過，詳見 `design/relationship-simplification-20261011.md` 的後續調整紀錄。
