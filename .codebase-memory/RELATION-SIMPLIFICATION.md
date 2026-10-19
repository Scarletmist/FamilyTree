# 封存按鈕與關係簡化後索引

更新日期：2026-10-11。專案：`D-FamilyTree`。full／persistent，狀態 indexed，index_status ready。

- 修改前索引保存於 `before-relation-simplification.graph.db.zst`。
- 完成後 `graph.db.zst` 包含 2575 個節點、8030 條關係。
- 核對 36 個相關來源、測試、設定與文件路徑，分頁完整；診斷為 `coverage-relation-simplification-20261011.json`。
- `family-workspace.css` 第 91、92、158 行仍回報 partial parse，已直接讀取補查；沒有 unusable 或 skipped 來源。
- 指定路徑的 freshness 仍回報 metadata_changed，實作以直接來源、瀏覽器結果及 Node 測試補核；ready 不是完整覆蓋保證。

本次沿用 codebase-memory Verify 流程，使用 addRelation、buildGroups、derive、tasks、compare 等結構查詢、呼叫追蹤及來源片段核對接點。實作與驗證見 `design/relationship-simplification-20261011.md`。

索引刻意排除 dist、vendor、二進位圖像及 `.codebase-memory/`。前各階段診斷與快照均保留；本文記錄新的完成狀態，不改寫歷史計數。
