# 專案與 harness 架構

本範本把 Harness² 的改進循環放在 Codex 桌面版的專案層。Codex 負責理解任務、提出假設、修改程式、組合候選與解讀證據；Python runner 負責凍結評估條件、執行已設定的測試、保存證據及檢查數值採用條件。

## 責任與資料流

| 元件 | 責任 | 更新時機 |
|---|---|---|
| `AGENTS.md` | 簡短長期規則、完整編排入口及三個工程捷徑 | 已驗證的通用工作方式改變時 |
| `.agents/skills/*/SKILL.md` | 除錯、回歸、實驗比較的按需流程 | 流程改進有證據時 |
| `docs/architecture.md` | 目前系統模組、資料流及邊界 | 模組或契約改變時 |
| `docs/acceptance_criteria.md` | 可觀測成功條件、資料與門檻 | 需求改變時；須開新實驗 |
| `docs/decisions.md` | 長期架構選擇及理由 | 決策影響後續工作時 |
| `harness/config.json` | 實際驗證命令、資料／環境 ID 與機器指標 | 設定改變後開新實驗 |
| `scripts/harness.py` | `doctor/new/run/compare/lesson` | runner 功能變更時 |
| `harness/experiments/<id>/` | 每次實驗的條件、假設、各版結果與決策 | 每次實驗；不要覆寫舊結果 |
| `harness/lessons.md` | 有情境、證據與限制的經驗索引 | 有支持採用的比較後 |
| `tests/harness/` | runner 本身的正反例測試 | runner 行為改變時 |
| `harness/skills.json` | 完整 18 技能的階段契約、上游對應與交接 | 核心技能拓撲改變時；開新實驗 |
| `scripts/harness_workflow.py` | parallel/sequential 依賴計畫、完整證據包、恢復狀態與報告 | 流程支援工具改變時 |
| `harness/experience/INDEX.md` | 跨任務、按領域與時序管理的採用版本索引 | 反思與經驗保留後 |

`new` → baseline → INV／DOM 提案與 probe → compose 並重測 → `compare` → 決策 → `lesson`。這是一個由目前 Codex 對話驅動的流程；腳本沒有自動 LLM 編排器。

完整技能分工見 `docs/WORKFLOW_COVERAGE.md`。18 個技能另覆蓋實驗／executor 設定、證據邊界、可編輯表面、逐項對照、選擇政策、反思、領域經驗、恢復／報告與事後評估；原三個工程技能只是便捷入口。

## 請補上實際應用架構

此處目前只有 harness 架構，尚未分析你的實際應用程式。導入時由 Codex 閱讀程式後補上：主要模組、入口點、資料流、關鍵介面、資料單位、建置與執行環境、重要的相容性約束。不能把範例的模組名稱當成專案現況。

## 實驗身份與可信範圍

- `controls.json` 保存 config、驗收文件、`input_files` 與 `evaluator_files` 的 SHA-256，以及 Python、作業系統與執行路徑。`task.md` 另外有摘要。任何一項改變，舊實驗拒絕繼續。請將 adapter 與固定測試的所有判定依賴列入 evaluator_files；未宣告依賴不會自動追蹤。
- `run` 每次建立新的 run ID，不以舊結果當快取。保存命令、退出碼、測試數、時間、metrics、日誌、harness 文件快照與 Git HEAD／工作樹狀態／tracked diff 摘要。
- 大型點雲、bag 或影像請以 `input_files` 指向含內容雜湊的資料清單；runner 只檢查清單本身，資料實體的雜湊驗證必須放進 project adapter。`data_id` 單獨只是宣告，不能證明檔案未變。
- Python 與 OS 身份不代表所有環境都相同；CUDA、ROS、驅動、套件、硬體與容器 image digest 應由 adapter 驗證及在 plan 記錄，變更時更新 `environment_id` 並開新實驗。
- Git metadata 無法還原未追蹤或未提交的應用程式。需要可重現實驗時使用可識別的 commit／保留 patch 與未追蹤來源。runner 保存的是 harness 快照，不是整個應用程式或完整桌面對話。
- 本工具處理受信任專案的證據一致性，不提供防惡意竄改、防任意執行或取代 OS sandbox 的安全邊界。

## 規則更改與生效

專案文件是 Codex 原生指示入口；`docs/`、`harness/` 是本範本約定，透過 `AGENTS.md`／技能引導讀取，並非每一檔案都會自動載入。更改長期指示後，使用新的任務／對話驗證載入情況，不假設進行中的對話會自動忘記舊指示或換用新系統提示。
