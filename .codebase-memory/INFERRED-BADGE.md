# 推導依據徽章索引

日期：2026-10-11。專案 `D-FamilyTree`，full／persistent，狀態 indexed。

- 修改前索引為 `before-inferred-badge.graph.db.zst`。
- 完成後索引包含 2580 個節點、8001 條關係。
- 核對 13 個來源、測試及文件路徑，分頁完整；診斷為 `coverage-inferred-badge-20261011.json`。
- `family-workspace.css` 第 91、92、158 行 partial parse 已直接讀取；metadata_changed 路徑以原始碼、測試及渲染結果核對，索引不保證完整覆蓋。

使用 Verify 流程核對 render／open 接點與焦點還原。直接記錄不提供獨立來源入口，推導由同一徽章開啟所有推導依據，操作列只保留補填。209 項 Node 測試、八組瀏覽器 context、關係政策／模擬 Drive、建置及 whitespace 檢查通過。實作及驗證見 `design/relationship-simplification-20261011.md` 最新一節。
