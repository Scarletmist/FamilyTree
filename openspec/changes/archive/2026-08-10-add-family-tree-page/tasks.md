## 1. DEMO 資料檔

- [x] 1.1 交付 Demo data module，實作設計決策「資料以 script 標籤載入全域常數，不使用 fetch 讀取 JSON」：建立 `data/family.js`，以 `const FAMILY = { people: [], unions: [], adoptions: [] }` 宣告全域常數，檔案內不使用 `import`、`export`、`module.exports`。驗證：於瀏覽器以 `<script src>` 載入該檔後，在 console 執行 `typeof FAMILY` 得到 `"object"`，且 `Array.isArray(FAMILY.people) && Array.isArray(FAMILY.unions) && Array.isArray(FAMILY.adoptions)` 為 `true`。
- [x] 1.2 交付 Person record shape 與 Birth and death year representation，實作設計決策「生卒年以字串表示，不使用 Date 型別」：填入 20 筆 `people`，每筆含 `id`（格式 `p<數字>`、全域唯一）、`name`、`gender`（`"M"` 或 `"F"`）、`birth`（字串）、`death`（字串或 `null`）、`gen`（1 至 4 的整數）。驗證：在 console 檢查 `FAMILY.people.length === 20`、`new Set(FAMILY.people.map(p => p.id)).size === 20`、每筆 `birth` 與非 null 的 `death` 皆為 `typeof "string"`、`gen` 值集合為 `{1,2,3,4}`。
- [x] 1.3 交付 Union record shape 與 Adoption record shape，實作設計決策「採用扁平 people 陣列加 unions 關係陣列，而非巢狀樹結構」：填入 `unions`（每筆含 `id` 格式 `u<數字>`、長度為 2 的 `partners`、`children` 陣列、`type` 為 `"marriage"` 或 `"remarriage"`）與 `adoptions`（每筆含 `child` 與 `union`），親子關係一律掛在 union 上而非個人上，領養的孩子不出現在該 union 的 `children` 中。驗證：在 console 檢查每筆 union 的 `partners.length === 2`、`type` 落在允許值內，且每筆 adoption 的 `child` 不存在於其 `union` 對應的 `children` 陣列。
- [x] 1.4 交付 Demo data coverage of edge cases 與 Referential integrity of demo data：確保資料含至少一筆 `type === "remarriage"` 的 union、至少一筆 adoption、至少一位 `birth` 以 `?` 結尾的族人、至少一位 `death === null` 的族人，且所有被 `unions` 與 `adoptions` 參照的 person id 與 union id 皆存在。驗證：在 console 執行檢查腳本，四種邊界案例各回傳計數大於 0，且所有參照 id 的查表結果無 undefined。

## 2. 族譜圖頁面

- [x] 2.1 交付 Family tree page document：建立 `family-tree.html`，以 `<script src="data/family.js">` 與 `<script src="assets/family-tree.js">` 載入資料與繪圖邏輯，樣式寫在頁面內的 `<style>` 區塊，不引用任何外部樣式表、CDN、web font 或函式庫，程式碼中不出現 `fetch` 或 `XMLHttpRequest`。驗證：以 `file://` 開啟頁面，Network 面板僅出現三個本機檔案請求、無任何外部主機請求；全文檢視兩個檔案確認無 `fetch`、`XMLHttpRequest`、CDN 網址。
- [x] 2.2 交付 Generation row layout，實作設計決策「世代分層橫列佈局搭配 SVG 連線，不使用佈局函式庫」：建立 `assets/family-tree.js`，讀取全域 `FAMILY`，將族人依 `gen` 值分成 4 個由上而下的水平列，列內依 `FAMILY.people` 順序由左至右排列，同一 union 的兩位配偶節點相鄰。驗證：在 console 檢查世代列元素數量為 4、族人節點總數為 20、每個節點所屬列的索引與其 `gen` 相符；任取一筆 union，其兩個 partner 節點的 DOM 位置相鄰。
- [x] 2.3 交付 Person node content：每個節點顯示姓名與生卒年；`death` 為日期字串者同時顯示生年與卒年，`death` 為 `null` 者只顯示生年並附在世標記且不顯示卒年；生卒年字串原樣輸出，不去除結尾問號。驗證：在 console 取出 `death` 為 `null` 的節點確認其文字不含卒年且含在世標記；取出 `birth` 以 `?` 結尾的節點確認顯示文字包含該問號。
- [x] 2.4 交付 Relationship connectors：在節點層上方以 SVG 繪製連線——每個 union 於兩位配偶之間畫水平連線，每個 `children` 成員自該 union 向下畫連線至子女節點，每筆 adoption 自其 union 向下畫連線至被領養者節點。驗證：在 console 統計 SVG 連線元素數量，等於 union 數 + 所有 `children` 總數 + adoption 數；任取一筆 union 確認其配偶連線的兩端座標對應到該兩個 partner 節點。
- [x] 2.5 交付設計決策「領養關係以虛線區別，在世者以標記區別」的視覺契約：領養連線以虛線繪製並帶有可供辨識的 DOM 屬性（例如 `data-kind="adoption"`），親生連線為實線並帶有不同的屬性值；在世者節點帶有可辨識的樣式類別。驗證：在 console 比對領養連線與親生連線的 `data-kind` 屬性值不同，且兩者的 `stroke-dasharray` 計算樣式不同。

## 3. 錯誤處理

- [x] 3.1 交付 Missing data file handling：當繪圖時全域 `FAMILY` 為 undefined，頁面在族譜圖區域顯示可見的錯誤訊息文字，而非空白或僅在 console 報錯。驗證：暫時將 `family-tree.html` 中資料檔的 script 路徑改為不存在的檔名並重新載入，確認頁面出現可見錯誤訊息，測試後將路徑改回。
- [x] 3.2 交付 Dangling reference tolerance：當 union 或 adoption 參照到不存在的 person id 或 union id 時，略過該筆關係不畫、在 console 輸出指出該 id 的警告，頁面其餘節點與連線照常呈現。驗證：在 console 以 `FAMILY.unions[0].children.push("p999")` 注入一筆不存在的 id 後重新繪製，確認出現指名 `p999` 的警告、連線數只少一條、20 個節點仍全數呈現。

## 4. 首頁串接與驗收

- [x] 4.1 交付 Sub-page entry cards 的修改：`index.html` 的「瀏覽族譜」CTA 與「族譜圖」卡片的 `href` 改為 `family-tree.html`，「成員列表」與「家族相簿」兩張卡片維持 `#`。驗證：在瀏覽器點擊 CTA 與族譜圖卡片皆導向族譜圖頁面且圖形正常呈現；在 console 檢查四個連結的 `href` 屬性值分別為 `family-tree.html`、`family-tree.html`、`#`、`#`。
- [x] 4.2 逐條核對 `openspec/changes/add-family-tree-page/specs/` 之下三份 spec 的全部 requirement 情境，確認實作與規格一致。驗證：每個 `#### Scenario` 的 WHEN/THEN 在瀏覽器中手動走過一次並成立，含 family-tree-data 的 7 項、family-tree-view 的 6 項，以及 family-homepage 修改後的 Sub-page entry cards。
