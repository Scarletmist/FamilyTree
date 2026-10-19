# 第五階段後索引與驗收

日期：2026-10-12，專案 `D-FamilyTree`，Verify 層級。

- 修改前索引快照：`before-phase5.graph.db.zst`，承接第四階段 2672 nodes／8460 edges。
- 完成後 full、persistent 索引：2730 nodes／8680 edges；`graph.db.zst`、`artifact.json` 已更新。
- 結構查詢核對 minimap refresh、viewport、路由 route、輸出 generate／printDocument、關係詳情 render 與共用依賴。對來源與配置另補讀原始碼。
- 87 個依據路徑的 coverage 保存於 `coverage-phase5-20261012.json`，全數返回且沒有截斷。
- `family-workspace.css` 第 91、92、158 行仍是 partial parse；已直接讀取。metadata_changed 以原始碼與測試補證，不將 indexed 狀態視為完整覆蓋保證。
- 219 項 Node 測試、43 組驗收最終通過；修正舊測試的折疊編輯／捨棄變更流程後只重跑該失敗 suite，保存先前報告。重跑核對正式程式、共用依賴與已通過測試未變更。
- 50／200／1000 人真實靜態流程、三種紙張／隱私 PDF 共 19 頁、手機尺寸截圖與發布包檢查完成。開發族譜未被測試改寫。
- iOS／Android 實機及真實 OAuth 未執行，report.releaseReady=false；沒有發布。

詳細工程與效能限制見 `design/phase5-implementation-20261012.md`；執行紀錄位於忽略的 `phase5-results/`。
