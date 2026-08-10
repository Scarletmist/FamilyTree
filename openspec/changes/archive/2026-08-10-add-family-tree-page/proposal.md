## Why

首頁三張入口卡與「瀏覽族譜」CTA 目前全部指向 `#`，網站沒有任何實際內容。族譜圖是這個網站存在的理由，也是驗證資料模型是否站得住腳的地方——族譜資料的真正難處（再婚、領養、生卒年不確定、在世者）不會在排版工作中浮現，只會在把人與關係畫成圖時浮現。

真實家族資料尚未蒐集完成，因此本次以刻意設計的 DEMO 資料驅動開發。DEMO 資料不是暫時的填充物，而是資料模型的第一版定義：它決定了之後每一筆真實資料能不能被表達。

## What Changes

- 新增族譜圖頁面 `family-tree.html`，以世代分層橫列的方式呈現四代族人，並以 SVG 線條連接配偶與親子關係。
- 新增 DEMO 資料檔 `data/family.js`，宣告全域常數 `FAMILY`，內含三個陣列：`people`（20 人）、`unions`（婚姻與其子女）、`adoptions`（領養關係）。
- 新增頁面腳本 `assets/family-tree.js`，負責讀取全域 `FAMILY`、計算節點座標、產生 DOM 與 SVG 連線。
- 資料以 `<script src>` 標籤載入而非 `fetch`，使 `family-tree.html` 維持以 `file://` 直接開啟即可運作，不需要本機伺服器或建置步驟。
- **BREAKING**：`index.html` 的「瀏覽族譜」CTA 由 `href="#"` 改為 `href="family-tree.html"`。既有的 family-homepage 規格明文要求該連結指向 `#`，此需求因此變更。

## Capabilities

### New Capabilities

- `family-tree-data`: DEMO 族譜資料的結構契約——people、unions、adoptions 三個陣列的欄位定義、識別碼規則、生卒年的字串表示法，以及資料必須涵蓋的邊界案例。
- `family-tree-view`: 族譜圖頁面的呈現與行為——世代分層佈局、配偶與親子連線、節點顯示內容、在世者與領養關係的視覺區別。

### Modified Capabilities

- `family-homepage`: Sub-page entry cards 需求變更——「瀏覽族譜」CTA 不再指向 `#`，改為指向已存在的族譜圖頁面；三張入口卡中的族譜圖卡片同步改為實際連結。成員列表與家族相簿兩張卡片維持 `#`。

## Impact

- Affected specs: `family-tree-data`（新增）、`family-tree-view`（新增）、`family-homepage`（修改）
- Affected code:
  - New: `family-tree.html`, `data/family.js`, `assets/family-tree.js`
  - Modified: `index.html`
  - Removed: (none)
- 不新增任何 npm 套件、建置工具或執行環境需求。驗證方式為以瀏覽器直接開啟 `family-tree.html` 與 `index.html`。
