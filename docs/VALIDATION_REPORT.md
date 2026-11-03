# 驗證紀錄

日期：2026-11-03。範本版本：2.0.0（完整 18 技能）。執行環境：Linux x86_64、Python 3.12.14。

| 項目 | 實際執行 | 結果 |
|---|---|---|
| Runner／installer 正反例 | `python3 scripts/harness_self_check.py` | 48 項測試，全部通過 |
| 18 技能的 frontmatter／命名檢查 | skill validator 對每個專案技能執行 | 全數通過 |
| 工具初始就緒檢查 | `python3 scripts/harness.py doctor` | structure=ok；project_ready=false；依設計回傳 2 |
| Python 語法編譯 | `python3 -m compileall -q scripts tests/harness` | 通過 |
| Bash 語法 | `bash -n scripts/run_regression.sh` | 通過 |
| Bash 入口實際執行 | 在 demo 專案執行 `run_regression.sh --experiment demo --label bash-wrapper` | project passed |
| 完整目錄導入 | installer 實際複製 70 檔至獨立目錄，再 dry-run | 實際複製成功；第二次零變更 |
| 完整確定性示範 | `python3 scripts/demo_harness.py --output ...` | baseline failed → compose passed → comparison eligible → lesson 追加成功 |

測試涵蓋：未設定實際專案、評估條件／輸入／任務／評估器內容變更、同名實驗覆寫、零測試、缺少結果、NaN 指標、非零退出、逾時、證據被更改、路徑逸出、缺少必要指標、絕對門檻、候選退步、平手保留基準、最大化指標、harness 自測不得支援 project 採用、缺比較不得寫 lesson、完整比較及 lesson 流程、installer dry-run／衝突保護／重複安裝／符號連結保護。

最終 demo 的實際識別碼：

- Baseline: `baseline-d1785cb41aa9`，四個案例通過三個，project status failed。
- Candidate: `compose-4afb2a4c0c81`，四個案例全通過，project status passed。
- Comparison: `comparison-904c2bc1adfd`，cases_passed 從 3 到 4，符合固定 min=4。
- Lesson 信心：`task-local`；限制明列只有四個人工案例，不代表 agent 工作流程的效益。

這些是工具與合成程式案例的驗證。沒有呼叫模型、沒有執行你的實際應用或資料，也沒有在你的桌面 Codex、Windows／PowerShell、WSL、ROS 或 GPU 上驗證。

技能觸發和持續指示是否被桌面 app 載入，必須在導入後用新任務檢查。結構驗證不代表模型行為評測已完成。

## 完整技能版新增驗證

- parallel k=3 的計畫為 12 次 solver 執行與 9 次提案／組合；每個組合都依賴全部 2k 候選。
- sequential k=3 保留原始基準並銜接 c1/c2 與累積候選；k=4 另檢查拓撲順序與無環依賴。
- catalog 實測 18/18；缺技能、缺模板、缺引用文件、重複名稱或未知交接都會拒絕。
- context 在測試中完整保留 75,000 bytes 以上附件，不截短；被修改的 run 證據不得進入 context。
- 實際 demo 建立 sequential k=2 計畫、包含 114 個來源檔的 context，並產生 status/report。這只是依賴與證據工具的實測；demo 仍只有兩次合成實作驗證，不是八次 agent 任務。
- 未完成 run、控制條件變更及不可覆寫報告均有測試；status 明列記錄完整性範圍，不把驗證 label 當作獨立 agent 執行。
- 另以獨立代理依技能處理 sequential k=2、INV 無交付且缺獨立 trace 的情境；其結論保留不確定性、拒絕直接泛化，並正確銜接補證據、對照、組合重測、選擇及反思。此為一個流程情境驗證，不代表所有技能的行為泛化都已量測。

仍未在你的桌面 Codex 或真實 project suites 執行，也沒有自動批次模型 API executor／benchmark judge。
