# 第二階段後索引

更新日期：2026-10-11。專案：`D-FamilyTree`，full／persistent，狀態：indexed。

- 第二階段前索引保留於 `before-phase2.graph.db.zst`。
- 目前索引 `graph.db.zst` 包含 2489 個節點、7826 條關係。
- 已核對 36 個相關原始碼與測試路徑，分頁完整；診斷保存於 `coverage-phase2-20261011.json`。
- 原有 `family-workspace.css` 第 91、92、158 行 partial parse 仍存在，已直接讀取原始碼補查。
- 指定路徑仍回報 metadata_changed，以實際原始碼和測試核對；indexed 不代表完全覆蓋。

第一階段的索引與診斷保留，見 `PHASE1.md`；原始修改前基準見 `BASELINE.md`。
