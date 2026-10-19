# 第一階段後索引

更新日期：2026-10-11。專案：`D-FamilyTree`，模式：full／persistent，狀態：indexed。

- 修改前索引：`before-phase1.graph.db.zst`；原始系統基準及限制見 `BASELINE.md`。
- 目前索引：`graph.db.zst`，2,424 個節點、7,527 條關係。
- 已對第一階段 24 個相關路徑完成 coverage 核對，沒有分頁遺漏；結果：`coverage-phase1-20261011.json`。
- 原有 `family-workspace.css` 第 91、92、158 行仍有 partial parse，已直接讀取這些原始碼。
- 所有指定路徑仍回報 `metadata_changed`，因此以實際原始碼與執行測試補查，不將 indexed 狀態視為完整覆蓋保證。

索引只更新結構資料，不包含 dist、示範族譜的發布輸出或真實使用者的 IndexedDB 資料。
