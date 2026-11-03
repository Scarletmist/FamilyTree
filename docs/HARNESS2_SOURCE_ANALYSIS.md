# Harness² 原始碼分析與 Codex 桌面版改寫

分析日期：2026-11-03。範本修訂版：2.0.0（完整 18 技能）。已實際取得並讀取 google-research/harness2 原始碼；分析固定在 commit `6868817518876de8fd170c6a8354daca273b6191`，commit 時間為 2026-11-01T18:17:27-08:00。以此版本為準，不把 main 後續變更視為本包已驗證內容。來源檔案與雜湊另見 `harness/UPSTREAM_PROVENANCE.json`。

## 一、適用方式與改寫範圍

你的目標適合採用「Codex 原生專案指示＋按需技能＋可重現的驗證工具＋有證據的經驗紀錄」。本包已實作這個結構；不是只將原本 README 改成 AGENTS，也沒有把原始 benchmark 執行器嵌入桌面 app。

Harness² 是模型外部的遞迴改進系統：一層在同一任務內比較執行流程，另一層把採用版本與經驗留給後續任務。模型權重不因這個過程更新。本版保留前述工作方法，改用你既有的桌面 Codex 對話作為提案與執行者，腳本只負責確定性的驗證與證據。

因此，這是**以 Harness² 設計改寫的專案層 harness**，不是原論文或 benchmark 的完整重製，也不宣稱已重現原始分數增益。

## 二、原始碼中的實際分工

| 原始檔案／入口 | 讀取後確認的責任 | 對本版的影響 |
|---|---|---|
| `core/spec.py`：BenchSpec、BenchmarkAdapter、RunView | 將任務介面、執行器與改進方法分離；RunView 不攜帶評分 | 專案任務／驗收、Codex 流程與 regression adapter 各自獨立 |
| `core/recursion.py`：run_parallel、run_sequential | 建立 INV／DOM 候選、執行 probes、產生組合版本並再執行 | orchestration、INV／DOM、probe、contrast、composition 等獨立階段技能銜接 |
| `core/recursion.py`：_run_stage、_accept_tree | 建立提案證據、驗證可編輯樹、無效提案重試、失敗時回退 | 保留有限重試與停止條件；不讓失敗導致無限修改 |
| `core/context.py`：build、mission | 將任務、原始軌跡、產出、候選與經驗置於檔案，提示只引導讀取 | 保存實驗證據與路徑，避免把所有內容擠進 AGENTS |
| `core/tree.py`：SurfaceSpec、is_allowed、validate | 定義允許修改的表面、技能／腳本驗證、長期指示大小限制 | 以短 AGENTS、明確技能入口及自測保持結構可讀 |
| `core/selection.py`：selection_pool、run_selection、reflect_adoption | 組合候選池、匿名選擇、採用後萃取經驗 | selection／reflection 獨立分工；工程模式用數值條件及產出審查，也提供隔離盲選程序 |
| `core/library.py`：Library.add、rebuild_index | 保存完整採用 harness，附選用理由及有情境的經驗索引 | run 內存 harness 快照；lessons 帶 cue、evidence 與 limits |
| `core/runmark.py` | 以完成標記及 harness／任務身份判斷結果是否可重用 | 本版每次新 run；凍結任務／控制條件並記錄 SHA-256 |
| `core/ledger.py` | 核對每個 recursion budget 對應的 rollout 與提案 session 數 | 預設一輪，明列成本來源，不將每輪視為單次模型呼叫 |
| `core/schedule.py`：run_task、_run_one_mode | 排程 shared baselines、各 mode、選擇與持久化 | Codex 對話驅動；workflow helper 產生 parallel／sequential 依賴計畫與預算 |
| `substrate/codex.py`：CODEX_SURFACE、materialise、exec_argv | 將 harness 檔案放入 Codex 工作區，並建立外部 CLI 執行參數 | 沿用原生 AGENTS／skills 路徑；不移植外部 CLI 啟動參數 |
| `install.py`、`config.py` | 安裝固定 Codex CLI 版本、建立獨立 provider 設定 | 不改你桌面 Codex 的模型、provider 或全域設定 |

## 三、兩種遞迴的處理流程

令 `k` 為原始碼的遞迴預算。兩種模式都先產生 `k` 份共享基準執行。

| 模式 | 提案與 probes | 組合與後續 |
|---|---|---|
| parallel | 從同一基準證據產生 `k` 個 INV 和 `k` 個 DOM 候選，probe 共 `2k` 次 | 每個組合可看到完整候選池；產生並執行 `k` 個獨立組合 |
| sequential | 每一輪從目前 harness 產生 INV／DOM，probe 兩者 | 組合出本輪版本，執行後將其與歷史證據帶到下一輪，共 `k` 輪 |

INV 偏向可跨領域重用的工作方式；DOM 偏向任務所屬領域的程序。兩者都可以改多個 harness 元件，不是固定對應某個資料夾。

`ledger.py` 的預算恒等式是 `R=4k` 次 solver rollout（`k` 基準＋`2k` 候選＋`k` 組合）和 `P=3k` 個提案／組合 session。這不等於總模型呼叫數：selector、反思、傳輸重試等另有成本。桌面版預設一輪只是成本控制選擇，並不承諾固定 token 費用。

### 一個需要修改的採用細節

該 commit 的 `selection_pool()` 明確只留下 `agg1..aggk` 或 `c1..ck`，排除基準執行。`schedule.py` 在 `k=1` 時走 `trivial_selection()`，不再呼叫 selector 比較多個候選。因此不能從原始碼推論「最後一定會保留比基準好的版本」。

本版改為：基準永遠保留、組合版必須重測、候選須通過絕對門檻與退步限制，並有至少一項達標改善；平手保留基準。`compare` 只是機器條件，實際產物與功能仍由 Codex／使用者檢查。這是為日常工程工作作的調整，並非聲稱修正上游研究方法。

## 四、八種 harness 元件如何映射

| Harness² 設計元件 | 桌面版專案中的落點 | 適用界線 |
|---|---|---|
| 系統提示 | `AGENTS.md` 的專案長期指示 | 專案指示不等於可替換 app 的 system prompt |
| Guardrails | AGENTS 的規則、驗收與腳本檢查 | 文字規則可被模型漏做；真正硬性要求應接入測試／CI |
| Memory | decisions、lessons、experiments | 以指示引導按需讀取，非自動讀取全部歷史 |
| Tool guidance | 技能內的工具用途、命令與證據契約 | 實際工具及依賴仍來自專案環境 |
| Subagents | 可選的隔離工作樹／新對話 | 本版不預設自動 spawn，不能把多份 SKILL 當成多個 agent |
| Skills | 18 個 `.agents/skills/*/SKILL.md` | 以 name／description 觸發，內文在使用時讀取 |
| Scripts | Python runner 與 shell 入口 | 用確定性程式執行測試與比較 |
| Plugins | 沿用 app 既有能力，另行設定 | 本版無需新 plugin，也不自動安裝 MCP 或 lifecycle hooks |

上游的八個設計維度不代表每個 substrate 都支援同一種檔案。`CODEX_SURFACE` 設定 `always_on=(AGENTS.md,)`、`skill_dir=.agents/skills`、`plugin_dir=None`，並定義自己的 hooks 表面；必須看執行器的實際轉譯，不能把 OpenCode 的外掛檔直接複製來用。

## 五、為什麼不直接搬原有 Codex executor

`CodexSubstrate.exec_argv()` 是外部 `codex exec`，使用獨立工作區、ephemeral 與 JSON 輸出，並含繞過 sandbox／approval／hook trust 的參數。`exec_env()` 指向獨立 CODEX_HOME；`install.py`／`config.py` 在此 commit 安裝 `@openai/codex@0.144.6` 並設定 Responses provider。SETUP 文件另提供 Vertex／LiteLLM bridge 路線。

這個架構用來編排可重現 benchmark 執行，不會把目前桌面對話接管成它的 solver。桌面版改寫採用已有的原生指示和當前工具權限，不攜入這些 bypass 選項，不要求替換模型端點，也不假設上游啟用的每種 hook 都可直接套用你的 app 設定。

本版已提供完整循環所需的 18 技能與階段契約，並有依賴排程、證據建構、狀態與報告工具。真正的自動批次 solver、原生獨立對話、完整 app 軌跡匯出及自動匿名 selector，仍須桌面原生能力或另行建立 CLI／SDK executor adapter；不能因新增技能就宣稱具備 app 未提供的 API。

## 六、驗收與經驗機制的調整

上游 `context.py`／`prompts.py` 刻意隔離 benchmark 的答案、grader verdicts 與評分資訊，提案依靠行為對照。本版是工程開發：使用者的公開需求、測試與驗收條件應可讀取；它們在比較前固定，候選不能放寬它們。兩者用途不同，不應把「benchmark 不看評分規則」誤套成「工程不看需求」。

上游經驗保留包含採用 harness 與原因。本版每個 run 保存 harness 檔案快照，decision 記錄採用差異，lesson 連回比較與限制。單次任務成功只支持 task-local 觀察，避免把偶然結果自動變成所有專案的規則。

對 prompt／技能的成效，使用相同起始應用 commit、相同輸入、模型與預算，在新對話重新解題；比較完成結果與程序證據。直接在同一份完成程式上重跑 regression，只驗證軟體，不驗證 agent 的解題效率、泛化或因果效果。

## 七、交付內容與已知邊界

版本 2.0.0 已交付 18 個完整專案技能及其選單 metadata、機器可讀技能契約、可執行 runner、workflow 排程／證據／恢復／報告工具、兩種 shell 入口、衝突保護的導入腳本、各階段模板、分領域經驗索引、中文說明、測試及 deterministic demo。完整對照見 `WORKFLOW_COVERAGE.md`。

尚未取得你的實際桌面專案原始碼、實際資料與工具鏈，所以 config 刻意未就緒。這不是已安裝到你的桌面，也不是已驗證應用功能。Windows／PowerShell／WSL、桌面載入、ROS／GPU 與實際 project suites 必須在你的環境驗證。

`doctor` 的技能檢查只支援本範本單行 name／description 格式，是結構檢查；不是完整 YAML 語法分析器，也不能證明模型會正確觸發技能。Linux 實測範圍見 `VALIDATION_REPORT.md`。

## 來源

- [Harness² repository](https://github.com/google-research/harness2)
- [固定版本的 recursion.py](https://github.com/google-research/harness2/blob/6868817518876de8fd170c6a8354daca273b6191/harness2/core/recursion.py)
- [固定版本的 selection.py](https://github.com/google-research/harness2/blob/6868817518876de8fd170c6a8354daca273b6191/harness2/core/selection.py)
- [固定版本的 schedule.py](https://github.com/google-research/harness2/blob/6868817518876de8fd170c6a8354daca273b6191/harness2/core/schedule.py)
- [固定版本的 Codex substrate](https://github.com/google-research/harness2/blob/6868817518876de8fd170c6a8354daca273b6191/harness2/substrate/codex.py)
- [原始 Setup guide](https://github.com/google-research/harness2/blob/6868817518876de8fd170c6a8354daca273b6191/docs/SETUP.md)
- [原始 Experiment guide](https://github.com/google-research/harness2/blob/6868817518876de8fd170c6a8354daca273b6191/docs/EXPERIMENTS.md)
- [OpenAI：Build skills](https://learn.chatgpt.com/docs/build-skills)
- [OpenAI：Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

官方文件確認專案 AGENTS 的分層讀取與 `.agents/skills` 的本地技能探索；其餘 docs／experiments／lessons 結構與狀態判定是本包設計，不是 Codex 產品內建的固定目錄或保證。
