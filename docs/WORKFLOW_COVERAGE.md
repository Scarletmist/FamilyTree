# Harness² 功能與完整技能對照

範本版本：2.0.0。本版共有 **18 個實際技能資料夾**，每個都有 SKILL.md 與選單中繼資料。原先的除錯、回歸、比較三種只保留為便利入口，不再限制整體設計。

## 一、原始功能如何分工

| 技能 | 對應上游功能 | 必要輸入 | 主要產出 |
|---|---|---|---|
| `harness-orchestration` | schedule／parallel／sequential recursion | 任務、專案、預算與既有經驗 | 完整階段編排及停止／回退決策 |
| `experiment-setup` | BenchSpec、BenchmarkAdapter、ledger | 真實來源、需求、資料與環境 | 凍結任務與控制條件、mode／k 計畫 |
| `executor-adaptation` | Substrate、Codex materialisation | 主機能力、工具、角色與設定提案 | 八種元件的實際能力映射與隔離執行交接 |
| `evidence-context` | ContextTree、context.build | 任務、原始軌跡、產物、候選與先前經驗 | 檔案證據包、索引與內容摘要 |
| `invariant-proposal` | INV proposer | 基準行為、目前 harness | 一般程序候選的實際檔案與機制假設 |
| `domain-proposal` | DOM proposer | 領域來源、基準行為、目前 harness | 領域推理／產物契約候選與依據 |
| `harness-surface-validation` | tree.validate、_accept_tree、有限重試 | 候選差異、允許範圍、host 能力 | 結構驗證或拒絕回饋／有效父版本 |
| `candidate-probing` | _roll、_roll_many、solver execution | 有效候選、固定任務／起始碼 | 實際產物、可得軌跡、驗證報告與 probe 紀錄 |
| `contrastive-analysis` | 對照式提案／組合的證據分析 | 基準集合、候選差異與 probes | 逐項 keep／revise／drop／不確定判斷 |
| `harness-composition` | aggregate、compose_round | 本輪與歷史候選、對照分析 | 實際組合樹、組合決策與重測交接 |
| `candidate-selection` | selection_pool、selector、trivial selection | 可用 finals、基準、產物與選擇政策 | 已承諾選擇、理由、匿名／非匿名標示 |
| `adoption-reflection` | reflect_adoption、_distil | 已選版本、所有 contrasts 與採用理由 | cue／lesson／evidence／confidence／limits |
| `experience-library` | Library.add、rebuild_index、domain chronology | 有依據的採用樹與反思 | 分領域保留、索引與後續檢索／再驗證 |
| `run-recovery-reporting` | runmark、resume、ledger、report | 控制身份、完成證據與階段計畫 | 恢復決策、預算核對與結果報告 |
| `outcome-evaluation` | judge、score、post-selection evaluation | 已選產物、獨立 evaluator／留出資料 | 實測分數或明確 unscored，不回灌舊選擇 |
| `debug-workflow` | 專案工程延伸 | 可重現缺陷與現行來源 | 定位、有限修改與回歸案例 |
| `regression-validation` | 工程 executor 的驗證介面 | 實作、固定測試與指標 | 真實 result.json、退出碼與數值證據 |
| `experiment-comparison` | 工程比較的便利入口 | 相互競爭方案 | 路由至完整編排與比較結果 |

機器可讀版本在 `harness/skills.json`，包含每個技能的來源對應、輸入、輸出及下一技能。可執行 `python scripts/harness_workflow.py catalog` 檢查名稱、必需檔案與交接是否齊全。

## 二、八種 harness 元件的覆蓋

| 上游設計維度 | 負責技能及落點 |
|---|---|
| 提示／指示 | INV／DOM 提案及 composition；專案 AGENTS 與任務指示 |
| Guardrails | surface validation、固定驗收與 evaluator、明確停止條件 |
| Memory | reflection、experience-library、分領域經驗索引 |
| Tool guidance | INV 提案與 executor-adaptation，含用途、輸入及錯誤處理 |
| Subagents | executor-adaptation 定義隔離角色，orchestration 在實際能力與授權內交接 |
| Skills | 18 個階段技能，及提案中有證據支持的新領域技能 |
| Scripts | 原有回歸 runner，加上 schedule／context／status／report 支援工具 |
| Plugins／hooks | executor-adaptation 與 surface validation 檢查實際 host schema；不把上游某個 substrate 的格式視為通用格式 |

八種維度是可改進的表面，不代表每次任務都必須新增八種檔案。選用最小且有機制依據的元件。

## 三、階段銜接

預設入口為 `harness-orchestration`。它先交給 experiment-setup、executor-adaptation 與 experience-library，再收集基準，經 evidence-context 將證據交給 INV／DOM。候選先 surface validation，再 probing，之後 contrastive-analysis 與 composition，再 probe 組合結果。

最終由 candidate-selection 決定產物／流程採用。選擇已承諾後，adoption-reflection 將觀察交給 experience-library；獨立 outcome-evaluation 衡量最後結果；recovery-reporting 整理未完成項、預算與限制。沒有改善時保留基準或目前 checkpoint，失敗的觀察仍能以未驗證假設保存在反思中。

### parallel 與 sequential

| 項目 | parallel | sequential |
|---|---|---|
| 基準 | k 個同一 base 的獨立任務執行 | 同左，原始基準集合各輪維持不變 |
| 提案 | k 個 INV 與 k 個 DOM，獨立從 base 開始 | 每輪 INV／DOM 從目前 checkpoint 開始 |
| 組合 | k 個 composition，各見完整 2k probe 池 | 每輪組合見本輪及累積歷史 |
| KEEP_CURRENT | 保留指定父版本 | 保留目前 checkpoint，與還原最初 base 分開記錄 |
| 預算身份 | 4k solver executions、3k proposer/composer sessions | 同左，selector／reflection／judge／retry 另計 |

`harness_workflow.py schedule` 會產生實際 dependency DAG 與預算；不會自動啟動 agent。並行模式的候選資訊獨立性與是否同時執行是不同條件：原生並行不可用時可逐一執行隔離任務，並揭露排程差異；不能在同一受污染對話內假稱候選彼此獨立。

## 四、技能與腳本的能力邊界

| 能力 | 本包實作 |
|---|---|
| 完整功能所需的操作流程 | 18 個技能，每個明列輸入／產出／交接／錯誤處理 |
| 固定驗證與比較 | `harness.py` 的 new/run/compare/lesson |
| 階段計畫及預算 | `harness_workflow.py schedule`，支援 parallel／sequential 任意 k=1..100 |
| 原始證據檔案包 | context 命令，複製明選 run 與附件，不截短檔案 |
| 恢復與報告 | status/report 檢查凍結身份、run 記錄完成狀態與證據摘要 |
| 自動遞迴模型 API 排程 | 未提供；由桌面 Codex／可用原生能力依技能執行 |
| 真正盲選 | 技能提供隔離與匿名化流程；無自動匿名封裝／獨立 selector 執行器 |
| 原始 benchmark 的 judge／dataset | 未附帶；outcome-evaluation 串接實際可用 evaluator，不能捏造分數 |
| 防洩漏與權限硬隔離 | 由既有平台／OS／執行器提供；技能規則與證據工具不等於安全邊界 |

功能流程完整涵蓋不等於靠 SKILL.md 就能新增 app 未提供的 API 或執行權限，也不代表上游 benchmark 成效已重現。

## 五、實驗產物契約

每個實驗沿用 `task.md`、controls、plan、decision、reflection。新增可按需使用的階段產物：

- `workflow.json`：腳本產生的依賴計畫。
- `proposals/<label>/proposal.md` 與 candidate tree：實際提案與機制。
- `probes/<label>/probe.md`：候選與實際 agent 執行／產物／驗證 run 的連結。
- `context/<context-id>/`：完整明選來源與 INDEX/MANIFEST。
- `contrasts/<id>.md`、`compositions/<label>/composition.md`：逐編輯對照與組合決策。
- `selection.md`：選擇政策、產物檢查、盲選狀態與已選 identity。
- `evaluation/<id>/outcome.md`：後於選擇的外部評估與錯誤狀態。
- `reports/<id>.json`：不可覆寫的摘要；不代表所有 agent 階段已自動完成。

模板均位於 `harness/templates/`。除明確有對應命令的檔案，其他內容由當前 Codex 任務依實際觀察撰寫，不會自動生成假的 trace、驗證或採用結論。
