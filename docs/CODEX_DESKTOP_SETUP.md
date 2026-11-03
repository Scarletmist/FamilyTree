# Codex 桌面版導入與使用

此包是專案層 harness。將檔案放進桌面版 Codex 已開啟的專案後，由 Codex 使用專案規則和工具；不需要為此設定 Vertex、LiteLLM、模型 API Key 或另一個 `codex exec`。需要 Python 3.10+；真正的 project suites 仍需原本的專案工具鏈。

## 1. 放進專案：先檢查、再套用

將壓縮檔解到獨立資料夾；下方 `project` 是本範本目錄，目標參數才是你的實際專案。

PowerShell：

```powershell
python .\project\scripts\install_harness.py 'D:\YourProject'
python .\project\scripts\install_harness.py 'D:\YourProject' --apply
```

Linux／WSL：

```bash
python3 ./project/scripts/install_harness.py /path/to/your-project
python3 ./project/scripts/install_harness.py /path/to/your-project --apply
```

第一個命令只列出計畫。若有不同內容的既有 `AGENTS.md`、文件、腳本或同名技能，工具會列出衝突並整批不複製。請在桌面版 Codex 中要求它比對後合併對應段落，再把其餘檔案放入適當位置；不可整份覆蓋原有規則。`--apply` 是你手動選擇的實際寫入命令，沒有額外互動式授權步驟。

本工具會排除 experiments 舊資料；它不修改個人技能目錄、全域 Codex 設定或 app 權限，也不直接操作你桌面的現有工作樹。若設定檔是新專案則保持本版格式；若原專案已有相同用途設定，合併時一併更新文件與命令路徑。

## 2. 在桌面版啟動與確認

開啟真正的專案根目錄，開始新的任務／對話。可貼上：

> 請讀取本專案 AGENTS.md，檢查 `harness/skills.json` 的 18 個技能與 WORKFLOW_COVERAGE，使用 harness-orchestration 列出目前要走的階段及其交接。請先閱讀實際程式，補齊 docs/architecture.md 與應用驗收，並設定 harness/config.json 的真實專案命令；不要把 harness 自我測試當成專案驗收。

AGENTS 是專案指示入口；技能的 name／description 是按需匹配入口。docs 和 lessons 透過明確路由按需讀取。若技能選單沒有更新，重新開啟專案或新建任務，並直接指定檔案確認，不把「檔案存在」等同於「目前對話已讀取」。

## 3. 設定 project suites

`harness/config.json` 初始 `project_ready=false`，只提供 harness 自身測試。`doctor` 在這個狀態回傳 2 是刻意設計。

在原有 harness suite 之外加上 project suite，設定真實資料與環境身份。以下命令是**你需要實作的 adapter 介面示例**，檔名不代表你的專案已經存在此檔：

```json
{
  "schema_version": 1,
  "project_ready": true,
  "data_id": "approved-fixtures-v1",
  "environment_id": "YOUR-VERIFIED-ENVIRONMENT",
  "input_files": ["harness/dataset_manifest.json"],
  "evaluator_files": ["scripts/harness.py", "scripts/project_regression_adapter.py", "tests/YOUR_FIXED_REGRESSION_TEST_FILE.py"],
  "metrics": {
    "volume_relative_error": {
      "direction": "min", "max": 0.15,
      "max_regression": 0.01, "min_improvement": 0.005
    }
  },
  "suites": [
    {
      "id": "project-regression", "group": "project",
      "command": ["{python}", "scripts/project_regression_adapter.py"],
      "cwd": ".", "timeout_seconds": 900
    }
  ]
}
```

`volume_relative_error` 只是幾何量測的選用範例；`0.15` 表示 15%，`max_regression=0.01` 表示容許增加 1 個百分點，`min_improvement=0.005` 表示至少改善 0.5 個百分點。容許退步也必須滿足絕對 max。選用別的指標時請改名、寫清楚單位，並在驗收文件同步說明。若同時比較多個 metric，所有指標都要符合絕對門檻與各自的退步容許，至少一個有達標改善。

`command` 是 argv 陣列，以 `shell=False` 執行；只有完整的一個 `{python}` 引數會替換為目前 interpreter。不解析管線、`&&` 或 shell 變數；需要這些時將邏輯寫進 adapter。每個 suite 自己的 `cwd` 必須位於專案內。

`evaluator_files` 必須列入 runner、實際 adapter、固定測試程式及判定結果所用設定檔，並換掉上例的示意路徑。這些檔案的內容也會凍結，不只凍結命令字串。runner 不會自動推導 evaluator 的所有 import 或外部依賴；漏列檔案不在內容保護範圍。被評估的 application 原始碼不要放進這份清單，因為它正是候選允許改變的部分。

### Adapter 證據契約

runner 會為每個 suite 建立全新的目錄，並以 `HARNESS_RUN_DIR` 傳入。adapter 執行真實測試、解析測試框架報告和量測輸出，最後寫入：

```json
{
  "schema_version": 1,
  "checks_run": 12,
  "checks_failed": 0,
  "metrics": {"volume_relative_error": 0.12}
}
```

寫入路徑為 `$HARNESS_RUN_DIR/result.json`。`checks_run` 必須是實際執行數，不能把跳過或未收集測試算成執行成功；上例的 12 與 0.12 只是格式示範，不能硬編成驗收結果。失敗時退出非零並保留真實數值；多個 suite 不得輸出重複 metric 名稱。`checks_failed` 必須含實際失敗及錯誤。缺少必要 metric、無窮值、NaN、缺結果或零測試都會失敗。

- pytest：執行指定測試集、輸出 JUnit XML，adapter 解析 tests／failures／errors／skipped，再整合應用 metrics。
- C++／CTest：以實際 CTest 測試結果組成契約，不只檢查編譯退出碼。
- ROS2：在已有 ROS 環境啟動 suite，解析 `colcon test-result` 或測試 XML；bag/scan 資料的讀取與量測驗證仍在 adapter。
- .NET：執行現有測試專案並輸出 TRX，adapter 解析實際執行／失敗計數。ASP.NET Web Forms 舊專案的建置工具依現有環境設定，不能假設都適用 `dotnet test`。

runner 不會從「程序退出 0」推測有測試成功；adapter 應有自己的真實報告解析與檢查。對沒有測試框架的實驗，將具體資料一致性／功能檢查各算一項，並保留檢查依據。

### 大型資料與環境

`harness/dataset_manifest.json` 可含各檔相對路徑、大小及 SHA-256。將它放進 `input_files`，並由 adapter 對實體資料驗證雜湊。runner 本身只凍結這些清單檔案，沒有自動驗證外部 TB 級原始資料。

Windows 專案用 PowerShell／Windows interpreter；WSL 專案在該 distro 與既有依賴內執行；ROS/CUDA 專案可維持 Linux／容器的既有路徑。不能混用兩邊的虛擬環境。環境或套件版本變更時更新 `environment_id` 並建立新實驗。

## 4. 先確認工具本身

```bash
python scripts/harness_self_check.py
python scripts/harness.py doctor
```

若只想試跑完整流程、尚未接上真實專案，可執行：

```bash
python scripts/demo_harness.py
```

demo 在獨立暫存專案內建立四個固定測試案例，依序跑錯誤的 clamp 實作、正確實作、比較及 lesson，最後印出證據目錄。它沒有呼叫 Codex 模型，也沒有驗證你的實際專案。

## 5. 在實際專案使用

先設定資料、命令、驗收與 adapter，再建立實驗。下方 `TASK_ID`、run ID 和 comparison ID 都要換成實際值。

```bash
python scripts/harness.py new --task TASK_ID --goal "可驗證的具體目標" --model "實際使用的模型" --codex-version "實際app版本"
python scripts/harness.py run --experiment TASK_ID --label baseline
```

在 `plan.md` 填寫 INV（一般流程）與 DOM（領域流程）假設。Codex 執行各候選並保存結果後，組合有證據支持的部分，再跑：

```bash
python scripts/harness.py run --experiment TASK_ID --label inv
python scripts/harness.py run --experiment TASK_ID --label dom
python scripts/harness.py run --experiment TASK_ID --label compose
python scripts/harness.py compare --experiment TASK_ID --baseline BASELINE_RUN_ID --candidate COMPOSED_RUN_ID
```

各 `run` 命令只驗證**當下檔案內容**；不會因 label 不同而自動切換版本。INV、DOM、compose 的檔案套用與工作樹隔離由當前任務安排。對「流程是否讓 agent 更會解題」的比較，應讓每個候選在同一起始 application commit 的獨立工作樹／對話解同一任務，然後把產生的變更與 regression 結果帶回同一實驗紀錄；不可在已修好的程式連跑測試後宣稱提示詞有效。

本版沒有 `adopt` 自動寫入命令。Codex 根據 compare 結果和實際產出填寫 decision，明確套用選定的檔案差異；不自動覆蓋 AGENTS、不替你提交或部署。支援採用的比較產生後，寫入有界限的經驗：

```bash
python scripts/harness.py lesson --experiment TASK_ID --comparison COMPARISON_ID --cue "何時適用" --lesson "證據支持的程序" --limits "這項觀察的限制"
```

同一實驗請由一個寫入者操作。run ID 每次新建；舊日誌不覆蓋。比較與 lesson 會再次檢查既有證據摘要；這是避免誤用舊證據的保護，不是抗惡意修改的驗證系統。

## 6. 日常可直接貼給桌面版 Codex 的任務

**除錯**：

> 請依本專案的 debug-workflow 先重現問題並定位原因，保留既有模組，完成最小必要修改，依 regression-validation 驗證。若缺少資料或環境，列出實際阻擋，不要宣告成功。

**比較方案**：

> 請依 experiment-comparison 比較基準、一般流程候選及領域流程候選。先固定資料、環境與驗收，限制一輪 Propose–Probe–Compose；組合後重新驗證，只將有證據的改善記入有適用範圍的 lesson。

**改善 harness 本身**：

> 請分析本次任務的原始證據，區分實作修正與工作流程改進。若要修改 AGENTS 或 SKILL，先說明假設並在同一起始程式版本的新任務驗證；單次測試通過只視為任務內觀察。

## 7. 完整 18 技能循環與支援命令

先讀 `WORKFLOW_COVERAGE.md` 的每個階段分工。可直接貼給 Codex：

> 請使用本專案 harness-orchestration，依完整 18 技能的階段契約執行 Harness² 流程。先設定真實 project suites，再固定任務、資料、evaluator 與起始 application 版本；預設 sequential k=1。分別產生 INV／DOM，檢查可編輯範圍、以新 context probe、逐項對照、組合後再測，完成選擇、反思與領域經驗保存。缺少原生能力或真實 evaluator 時明列限制，不要宣稱已完成獨立 agent 試跑。

查看完整技能及資源交接檢查：

```bash
python scripts/harness_workflow.py catalog
```

在 `new` 後建立模式／預算的固定依賴計畫：

```bash
python scripts/harness_workflow.py schedule --experiment TASK_ID --mode sequential --k 2
```

parallel 模式改用 `--mode parallel`。同一 experiment 不能換成不同計畫；另開實驗可避免誤用舊狀態。k=2 對應計畫中的 8 次 solver 任務執行、6 次提案／組合 session，其他選擇、反思、評估與重試另計。

建立原始證據快照，附件必須先存在且由操作者明確選定：

```bash
python scripts/harness_workflow.py context --experiment TASK_ID --run RUN_ID --attach harness/experiments/TASK_ID/probe-notes.md --output harness/experiments/TASK_ID/context/base-evidence
```

工具不截短選定的來源檔案；它也不自動擷取 app 對話或判斷附件是否含隱藏評分資料。benchmark 模式由操作者保持答案／judge outcome 的隔離；工程模式可使用事前公開的測試與驗收數值。

恢復與摘要命令：

```bash
python scripts/harness_workflow.py status --experiment TASK_ID
python scripts/harness_workflow.py report --experiment TASK_ID --output harness/experiments/TASK_ID/reports/summary-01.json
```

兩者的成功退出碼只表示記錄完整性檢查通過，**不表示所有 agent 階段完成**。請讀取 `labels_without_validation_evidence`、`all_planned_execution_labels_have_records` 和 `agent_executions`，並檢查 probe.md、實際產物、trace、composition 與已承諾選擇。即使所有 label 都有驗證紀錄，也不能自動證明 agent 的獨立性或方法效益。

`harness/templates/` 已包含各階段的 proposal、probe、contrast、composition、selection、experience、executor、recovery 與 outcome 模板。由 Codex 依觀察填寫，不以模板存在當作工作已執行。

## 回傳碼

| 命令 | 0 | 1 | 2 |
|---|---|---|---|
| doctor | 結構及 project 設定就緒 | — | 未設定或設定錯誤 |
| new | 已建立並凍結 | — | 輸入錯誤／ID 已存在 |
| run | suite 與指標通過 | 測試／量測／逾時等失敗 | 尚未設定／凍結條件不一致 |
| compare | 數值條件支持採用 | 不支持採用，含平手 | 證據或設定錯誤 |
| lesson | 已追加有證據的任務內經驗 | — | 沒有有效比較或證據變更 |

本包在 Linux 實際執行 Python、Bash 與 demo；Windows／PowerShell、WSL、GPU／ROS 及桌面 app 的實際載入需在你的環境驗證。
