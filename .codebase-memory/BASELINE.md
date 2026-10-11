# 修改前系統索引

建立日期：2026-10-11（Asia/Taipei）。

- 工具：codebase-memory-mcp 0.11.0 官方 CLI。
- 專案：`D-FamilyTree`。
- 工作區：`D:/FamilyTree`。
- 模式：`full`，`persistence: true`。
- 驗證狀態：`index_status` 回報 `ready`。
- 節點：2,346；關係：7,205。
- Git HEAD：`bef3abd84bfe1e860aa0d3dec71eaa0134de5b0e`。
- 分支：`codex/function-add-1011`。
- 索引檔：`graph.db.zst`；持久化資訊：`artifact.json`。
- 後續主要模組覆蓋診斷：`coverage-baseline-20261011.json`，24 個指定路徑及 src／tests／dev 範圍，診斷分頁已完整取得。

建立索引期間未修改 src、tests、dev 或族譜資料；工作區原有一份未追蹤的實作計畫文件。MCP 呼叫回報 Transport closed，因此使用工具內建的 one-shot CLI 完成建立、重建及驗證，沒有停止其他 MCP 服務或變更其設定。

## 已知覆蓋限制

- `.git`、`.codebase-memory`、dist、vendor、node_modules 及 Python 快取等由工具規則排除；42 個圖片／SVG 等檔案未建立結構索引。
- `src/assets/family-workspace.css` 第 91、92、158 行有 partial parse 訊號，已直接讀取原始碼核對；這是解析覆蓋限制，不是已確認的 CSS 執行錯誤。
- 指定的 24 個路徑在新鮮度診斷仍回報 `metadata_changed`。按工具建議完整重建一次後，提示仍存在；原始碼的 Git diff 保持空白，但不能因此將該診斷解讀為「完全新鮮」或完整覆蓋。
- 後續結構查詢可先使用圖索引定位候選；引用重要符號前仍須 check_index_coverage，對新鮮度提示及 CSS 缺漏範圍直接讀取原始碼補查。

這份索引建立了修改前基準。後續修改後應更新索引，並保留本次 HEAD 與覆蓋診斷作為比對依據。
