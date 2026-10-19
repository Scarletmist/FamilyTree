# 第三階段後索引

更新日期：2026-10-11。專案：`D-FamilyTree`，full／persistent，狀態：indexed，index_status：ready。

- 第三階段修改前索引保留於 `before-phase3.graph.db.zst`。
- 目前索引 `graph.db.zst` 包含 2572 個節點、8019 條關係。
- 核對 39 個相關原始碼、測試與設定路徑，分頁完整；診斷保存於 `coverage-phase3-20261011.json`。
- 原有 `family-workspace.css` 第 91、92、158 行 partial parse 仍存在，已直接讀取原始碼補查；新增證據模組沒有 reported parse gap。
- 指定路徑仍回報 metadata_changed，以實際原始碼、渲染截圖與測試核對；ready 不代表完全覆蓋。

第三階段使用 Verify 層級，從 buildGroups／appendFullDetails／describe 等結構查詢、呼叫追蹤及精確來源片段確認接點。共用證據與手機詳情的實作／驗證見 `design/phase3-implementation-20261011.md`。

前兩階段索引及診斷保留，見 `PHASE1.md`、`PHASE2.md`；原始基準見 `BASELINE.md`。
