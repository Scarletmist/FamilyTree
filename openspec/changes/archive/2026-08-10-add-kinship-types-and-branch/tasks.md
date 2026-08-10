## 1. 資料模型改版

- [x] 1.1 交付 Descent record shape 與 Union record shape，實作設計決策「親子關係合併為單一 descents 陣列，以 kind 欄位區分五種類型」與「移除 unions 的 type 欄位」，並完成 Adoption record shape 的移除遷移：在 `data/family.js` 中刪除 `adoptions` 陣列與每個 union 的 `children`、`type` 欄位，新增頂層 `descents` 陣列，原 `children` 成員改寫為 `kind` 為 `親生` 的 descent、原領養項目改寫為 `過繼`。驗證：在 console 檢查 `FAMILY.adoptions === undefined`、`FAMILY.unions.every(u => !('type' in u) && !('children' in u))` 為 true、`FAMILY.descents` 每筆皆含 `union`/`child`/`kind` 三欄且 `kind` 落在五個允許值內。
- [x] 1.2 交付 Bond record shape，實作設計決策「新增 bonds 陣列表達同輩關係」：在 `data/family.js` 新增頂層 `bonds` 陣列，每筆為 `{ members, kind }`，`members` 為長度 2 的 person id 陣列、`kind` 為 `契手足`，且不要求兩人 `gen` 相同。驗證：在 console 檢查 `FAMILY.bonds` 每筆 `members.length === 2` 且 `kind === "契手足"`；至少一筆 bond 的兩位成員 `gen` 值不同，確認跨輩分資料被接受而非被視為錯誤。
- [x] 1.3 交付 Demo data coverage of edge cases 與 Referential integrity of demo data：擴充 DEMO 資料使五種 descent `kind` 各至少一筆、`bonds` 至少一筆，並維持不確定生年與在世者各至少一例、世代 1 至 4 皆有人。驗證：在 console 統計五種 kind 的筆數皆大於 0、`FAMILY.bonds.length > 0`；將 `descents`、`bonds`、`unions` 中所有被參照的 person id 與 union id 逐一查表，結果無 undefined。

## 2. 房別推導

- [x] 2.1 交付 Branch computation interface 與 Branch attribution is derived, never stored，實作設計決策「房別推導獨立成 assets/branch.js，與繪圖分離」：建立 `assets/branch.js`，以全域函式 `computeBranches(family)` 對外，回傳以 person id 為鍵、值為 `{ path, label }` 的物件，函式不修改傳入資料、不觸碰 DOM、不使用模組語法，且 `people` 不得新增房別欄位。驗證：在 console 以 `JSON.stringify(FAMILY)` 於呼叫前後比對字串相同（確認未變動輸入）；檢查回傳物件涵蓋全部 person id、每個 `path` 為陣列且 `label` 為字串；檢查 `FAMILY.people` 每筆無任何房別欄位。
- [x] 2.2 交付 Lineage-conferring descent kinds：`computeBranches` 只讓 `kind` 為 `親生`、`過繼`、`養子女` 的 descent 傳遞房別，`義子女`、`契子女`、`bonds` 以及未知 kind 皆不傳遞。驗證：在 console 取一位僅以 `義子女` 或 `契子女` 連結的族人，確認其 `path` 為空陣列；取一位以 `過繼` 連結者，確認其 `path` 長度大於 0。
- [x] 2.3 交付 Rank ordering among a lineage parent's children，實作設計決策「排行以出生年決定，並以確定性規則處理不確定與同年」：以承繼房別的那一位父母為單位，蒐集其在所有 union 中的承繼子女合併排行，依 `birth` 前四字元的年份升冪；女兒與兒子同列不分性別，過繼者參與排行；婚入配偶不作為排行單位；同年時以在 `FAMILY.descents` 中出現的先後決勝。驗證：在 console 確認陳文彬排行 1、陳秀琴 2、陳文德 3、陳文山 4；連續呼叫 `computeBranches(FAMILY)` 兩次，比對兩次結果的 JSON 字串完全相同。
- [x] 2.4 交付 Nested rank path composition，實作設計決策「房別由譜系推導，不儲存於資料」：族人的 `path` 為自始祖沿承繼邊往下每一代排行序號的串接，無承繼父母者 `path` 為空陣列。驗證：在 console 確認陳阿土 `path` 為 `[]`、陳文彬 `[1]`、陳建國 `[1,1]`、陳淑芬 `[1,2]`、張家豪 `[2,1]`、陳志明 `[1,1,1]`。
- [x] 2.5 交付 Chinese branch label composition，實作設計決策「排行路徑轉中文標籤採房、支、派三層加數字後綴」：第一層用 `房`、第二層 `支`、第三層 `派`，序號 1 為 `長`、2 以上用中文數字，第四層以後以連字號接阿拉伯數字，空路徑標籤為 `始祖`。驗證：在 console 確認 `[]` → `始祖`、`[1]` → `長房`、`[4]` → `四房`、`[1,2]` → `長房二支`、`[1,1,1]` → `長房長支長派`、`[1,2,3,4]` → `長房二支三派-4`。
- [x] 2.6 交付 Spouse branch labelling 與 Cycle tolerance in branch computation：無承繼 descent 但為 union partner 者，標籤取另一位 partner 的標籤且自身 `path` 維持空陣列；追溯承繼邊時若重訪目前路徑上的人，中止該路徑、於 console 輸出指名該 person id 的警告、該人標籤留空，其餘族人照常推導。驗證：在 console 確認林氏、王美雲、吳雅婷等婚入者的 `label` 等於其配偶標籤且 `path` 為 `[]`；另行注入一組互為祖先的 descent 後呼叫 `computeBranches`，確認出現指名該 id 的警告、該人 `label` 為空字串、其餘族人仍取得標籤，且呼叫在有限時間內返回而非堆疊溢位。

## 3. 族譜圖呈現

- [x] 3.1 交付 Family tree page document：`family-tree.html` 在既有兩個 script 之外載入 `assets/branch.js`，三個腳本皆為本機相對路徑，頁面不引用外部樣式表、CDN、web font 或函式庫，且三個檔案皆不含 `fetch` 或 `XMLHttpRequest`。驗證：以 `file://` 開啟頁面確認族譜圖正常渲染且 console 無錯誤；全文檢視三個檔案確認無 `fetch`、`XMLHttpRequest`、CDN 網址。
- [x] 3.2 交付 Person node content：每個節點在姓名與生卒年之外顯示該族人的房別標籤，標籤為空時不輸出任何標籤元素或佔位文字；生卒年既有行為維持不變（在世者只顯示生年加標記、不確定年份保留問號）。驗證：在 console 確認陳淑芬節點顯示 `長房二支`、陳阿土顯示 `始祖`；取一位標籤為空者確認其節點內無房別元素；確認 `death` 為 null 者仍無卒年且帶在世標記、`1895?` 仍含問號。
- [x] 3.3 交付 Relationship connectors：為 union、五種 descent kind、bond 共七類關係各繪製連線並賦予七個相異的 `data-kind` 屬性值，承繼的三種 kind 與非承繼的兩種 kind 採可區分的線條樣式，`bonds` 連線串接兩位成員節點；頁面圖例列出全部七類。驗證：在 console 蒐集所有連線元素的 `data-kind` 值，確認相異值恰為 7 個；比對承繼與非承繼連線的 `stroke-dasharray` 計算樣式不同；確認 bond 連線兩端座標對應到 `members` 的兩個節點；目視確認圖例有六個項目。
- [x] 3.4 交付 Dangling reference tolerance：`descents`、`bonds`、`unions` 參照到不存在的 id 時略過該筆並於 console 輸出指名該 id 的警告；descent 的 `kind` 為五個允許值以外時，以預設線條樣式繪出並輸出指名該 kind 的警告，兩種情況都不中斷其餘渲染。驗證：在 console 注入一筆 `child` 為 `p999` 的 descent 後重繪，確認出現指名 `p999` 的警告且其餘節點與連線照常；另注入一筆 `kind` 為 `未知關係` 的 descent，確認連線仍被繪出、出現指名該 kind 的警告，且該族人未因此取得房別。

## 4. 詞彙檔與驗收

- [x] 4.1 交付 Project vocabulary file、Kinship term entries 與 Recorded drift of the term adoption：建立 `openspec/LANGUAGE.md`，每則詞條含正規用語、定義、避免使用的同義詞、以及該區別為何重要；為 `親生`、`過繼`、`養子女`、`義子女`、`契子女`、`契手足`、`房` 各建一則詞條，六則親屬詞條皆註明是否承繼房別；另建一則詞條標記英文 `adoption` 為應避免的籠統用語，列出它會混淆的四個中文詞並指向具體用語。驗證：內容審閱確認七則詞條各含四個欄位、六則親屬詞條皆有承繼與否的敘述、`adoption` 詞條列出四個中文對應詞。
- [x] 4.2 逐條核對 `openspec/changes/add-kinship-types-and-branch/specs/` 之下四份 spec 的全部 requirement 情境，確認實作與規格一致。驗證：每個 `#### Scenario` 的 WHEN/THEN 在瀏覽器中手動走過一次並成立，含 family-tree-data、branch-attribution、family-tree-view、project-vocabulary 四份；規格中的 `##### Example:` 表格逐列比對實際輸出值。
