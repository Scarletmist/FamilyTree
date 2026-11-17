# 族譜應用程式驗收條件

以下 P-xx 是應用程式的固定驗收依據。使用測試中的合成族譜，禁止以真實 Google 帳號或使用者族譜做自動化資料修改。

| ID | 輸入／操作與必須成立的結果 | 驗證來源 |
|---|---|---|
| P-01 | 新增、編輯、匯入與關係推論保留來源資料；缺失參照、循環與矛盾排行被拒絕 | Node `*.test.cjs`；命令管線測試 |
| P-02 | IndexedDB 寫入在同一 transaction 檢查最新版本、寫入資料、復原歷史及 sync dirty；失敗不改版本 | 儲存／命令回歸；命令管線測試 |
| P-03 | 舊版本新增重試只建立一位成員；其他 stale 寫入回傳衝突；undo 完整還原資料 | Node server／commands；命令管線測試 |
| P-04 | 排行 0 → -1 仍顯示錯誤、aria-invalid=true；改成 1 才清除錯誤描述，保留原有提示；重設無舊錯誤 | `browser-p1-accessibility.cjs`，五種 viewport |
| P-05 | 自製下拉可存取名稱含欄位名稱與目前值；鍵盤、滑鼠選擇、Esc、程式重設保持一致 | 同上；既有 UI 流程 |
| P-06 | 圖譜背景刷新保留人物焦點；人物消失回到命名畫布；不搶表單、工具列、picker 焦點 | 同上 |
| P-07 | API／靜態模式在 1440×1000、390×844、360×640、844×390 的側欄、排行、合併、undo、輸出流程正確 | `browser-ui-improvements.cjs` |
| P-08 | 發布包使用瀏覽器儲存及相對資源、不含使用者／測試族譜、資源引用完整 | `build`、`check:release`；對應 Node 測試 |
| P-09 | 100、500、1000 位成員的 households／cohorts 合成資料，在單次 FamilyApp.addMember 管線中，完整 Model.build 次數最多 4；無 stale／重試／undo 退步 | `browser-performance-pipeline.cjs`；每組暖身後三次取樣；harness metric |

## P-09 的量測與採用規則

資料生成器版本由 `tests/helpers/performance-fixture.cjs` 凍結。households 每組最多 12 人、cohorts 每組最多 48 人，包含配偶與雙親來源記錄。三個規模各測兩種形狀，逐組暖身一次後取樣三次，記錄每筆毫秒與建置次數、中位數、來源檔 SHA-256、Node／瀏覽器版本。

`add_member_builds_max` 是所有有效取樣中最大的完整 `FamilyModel.build` 次數（含閉包內部呼叫），越小越好；絕對上限 4、容許退步 0、比較採用至少減少 1 次。量測透過測試伺服器在 build 函式入口增加計數器，沒有更換演算法或跳過驗證。

計時範圍為 FamilyApp → Repository／Commands → 狀態採用；不包含 DOM 圖譜繪製及使用者輸入等待。因此這是本機命令管線的 lab 時間，不是網站 INP、真機體感或全面效能分數。毫秒數只報告，不設定跨硬體的絕對門檻；採用以確定性的建置次數與功能測試共同決定。

## Harness 對接

`harness/config.json` 已對接真實 Node、瀏覽器 smoke 與命令管線三個 project suites。adapter 解析實際 Node TAP 摘要、PASS／FAIL 情境及 PIPELINE_RESULT，寫入 `HARNESS_RUN_DIR/result.json`。零執行、缺結果、非零退出或不完整指標均失敗。

`project_ready=true` 僅表示這些應用套件已設定；不等於所有瀏覽器、真機、硬體及真實 OAuth 都通過。環境版本由每次證據記錄；更換評估命令、資料生成器、測試或此文件，必須建立新的 experiment。

H-01～H-07 仍屬 harness 自身驗證：未設定 project suites 不宣告應用成功、缺資料不通過、比較控制固定、符合絕對門檻、平手不採用、無證據不建 verified lesson，以及導入工具的 dry-run／衝突保護。它們由 `tests/harness/` 驗證，與 P-xx 分開報告。
