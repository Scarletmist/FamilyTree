## Why

族譜圖目前只能表達兩種親子關係（親生、領養），且完全無法回答傳統族譜最常被問的問題：這個人是哪一房的。

兩個問題有共同的成因。親子關係目前有兩條平行路徑——`unions[].children` 記親生、`adoptions[]` 記領養——每新增一種關係就要多一個陣列、多一次繪圖迴圈、多一條規格。要支援過繼、養子女、義子女、契子女五種親子關係加上同輩的契兄弟姊妹，這個結構會產生六處平行修改。房別則因為沒有明確的關係分類，無法判斷哪些關係承繼宗族身分、哪些只是社交連結。

## What Changes

- **BREAKING**：`FAMILY.unions[].children` 與 `FAMILY.adoptions` 兩個陣列移除，合併為單一 `FAMILY.descents` 陣列，每筆以 `kind` 欄位標示親子關係類型，共五種：親生、過繼、養子女、義子女、契子女。
- **BREAKING**：`FAMILY.unions[].type` 欄位移除。婚姻不再區分元配與續弦，只有單一種類，因此該欄位沒有可承載的資訊。
- 新增 `FAMILY.bonds` 陣列，表達同輩之間的契兄弟姊妹關係。這是資料模型中第一種既非婚姻、也非跨代的關係。
- 新增房別推導：族人的房別不儲存於資料中，而是沿著 `kind` 為親生、過繼、養子女的 descent 邊往上追溯至始祖，由路徑上每一代的排行組成巢狀排行路徑。女兒與兒子同樣開房，過繼者參與排行。
- 族譜圖節點顯示所屬房別的中文標籤，五種親子關係與契兄弟姊妹關係各自以可區分的線條樣式繪製。
- DEMO 資料擴充，使義子女、契子女、契兄弟姊妹三種目前沒有任何實例的關係各自具備可驗證的資料。
- 新增專案詞彙檔，定義房、過繼、養子女、義子女、契子女、契兄弟姊妹的中英對照與規格用語。

## Capabilities

### New Capabilities

- `branch-attribution`: 房別歸屬——哪些親子關係類型承繼宗族身分、排行如何決定（含生年不確定與同年的決勝規則）、巢狀排行路徑如何組成與如何轉為中文標籤、配偶與始祖的房別規則。
- `project-vocabulary`: 專案詞彙表——族譜領域中文術語與規格英文用語的對照契約，記錄目前 `adoption` 一詞混指四種不同關係的漂移。

### Modified Capabilities

- `family-tree-data`: Union record shape 移除 `type` 欄位；Adoption record shape 由 Descent record shape 取代並涵蓋五種 `kind`；新增 Bond record shape；Referential integrity 與 Demo data coverage of edge cases 的檢查範圍隨新結構調整。
- `family-tree-view`: Person node content 增加房別標籤；Relationship connectors 由兩種線條樣式擴充為五種親子關係加一種同輩關係；Dangling reference tolerance 的容錯範圍涵蓋新的 `descents` 與 `bonds`。

## Impact

- Affected specs: `branch-attribution`（新增）、`project-vocabulary`（新增）、`family-tree-data`（修改）、`family-tree-view`（修改）
- Affected code:
  - New: `assets/branch.js`, `openspec/LANGUAGE.md`
  - Modified: `data/family.js`, `assets/family-tree.js`, `family-tree.html`
  - Removed: (none)
- 不新增任何套件、建置工具或執行環境需求。頁面維持以瀏覽器直接開啟 `family-tree.html` 即可驗證。
- 既有 DEMO 資料的房別編號會改變：陳文山在舊有直覺下是二房，套用新規則（女兒開房、過繼參與排行）後成為四房。
