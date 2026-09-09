# 族譜網站

## 兩人關係查詢與稱謂設定

選擇 A 與 B，按「查詢兩人關係」。B 是稱呼基準，結果顯示「A 為 B 的……」。畫布僅顯示所選路徑上的成員與連線，例如堂親會保留兩人的父親，以及資料中用來連接父親的共同祖先。「交換 A／B」可查看反向稱呼，「顯示全部」可回到完整族譜；查詢不會改寫成員 JSON。

稱謂及規則儲存在 `data/kinship-terms.json`。網頁啟動時自動讀取此檔案，修改後重新整理即可生效，無需修改 JavaScript。載入或格式錯誤時會顯示重試按鈕，原有族譜仍可使用。稱謂依據[教育部《國語辭典簡編本》親朋稱呼表](https://dict.concised.moe.edu.tw/appendix.jsp?ID=12&la=1&powerMode=0)，來源網址與查核日期也記錄於設定檔。

- `direct`：單一關係的稱呼；`labels`：可重用的稱謂運算式。
- `rules`：依順序比對，第一條符合者生效。`patterns` 由 B 走向 A，例如 `parent/sibling/child` 表示父母的手足的子女；`when` 的各條件須同時成立。經同一父母的 `parent/child` 會在判讀時折合為 `sibling`，畫布仍保留實際父母。
- `label` 可為文字，或 `{ "ref": "稱謂鍵" }`、`{ "select": "target.gender", "cases": { "M": "…", "F": "…", "default": "…" } }`、`{ "join": [運算式, "文字"] }`、`{ "field": "target.rankPrefix" }`。程式以固定運算器處理，不執行設定檔內的程式碼。
- 條件欄位有 `target.gender`、`target.orderToBase`、`target.rankPrefix`、`steps.0.gender` 等；`steps` 從 0 起算，指每段路徑抵達的成員。`orderToBase` 與 `orderToPrevious` 分別比較基準成員及上一段成員的手足序，值為 -1（年長）、1（年幼）、0（未知）。這些次序僅適合已知手足，不能用於堂表親跨家庭比較。
- `notes`、`display`、`numerals` 控制補充提示、顯示文字與次序數字；`familyTypes`、`familyKinds` 控制優先搜尋的親屬關係範圍。

支援直系、手足、堂表親、伯叔姑舅姨、姪甥及常見姻親稱呼，另保留契手足、師徒與同門關係。未知性別或長幼會使用合併稱呼並提示；直接記錄的祖孫關係不會憑空補上父母或推定父系／母系。無適用稱謂時，顯示逐段關係。優先搜尋親屬路徑，無親屬路徑才搜尋其他關係；多條等長路徑最多列出 12 條，並保留直接記錄的其他關係供切換。

驗證：`node --test tests/*.test.cjs`；有 Playwright 時可執行 `node tests/browser-kinship.cjs`，以 `PLAYWRIGHT_MODULE` 指定模組位置，`PLAYWRIGHT_CHANNEL` 指定瀏覽器（預設 msedge）。

## 啟動

需要 Node.js 20 或更新版本，無需安裝第三方套件。在此資料夾執行：

```sh
node server.cjs
```

開啟 http://127.0.0.1:4173/family-tree.html 。也可使用 `npm start`。
伺服器只監聽本機。直接雙擊 HTML 不會啟用讀寫功能。
若連接埠已使用，可設定 `PORT` 換一個連接埠。

## JSON 資料

唯一的資料來源是 `data/family.json`。每位成員包含自己的關係清單：

```json
{
  "id": "p-example",
  "name": "範例成員",
  "location": "臺中市",
  "position": "教師",
  "gender": "F",
  "siblingOrder": 7,
  "relationships": [
    { "type": "parent", "personId": "p11", "kind": "親生" },
    { "type": "parent", "personId": "p15", "kind": "親生" },
    { "type": "teacher", "personId": "p24" }
  ]
}
```

根物件為 `{ "schemaVersion": 2, "familyName": "陳氏家族", "people": [...] }`。`familyName` 為可選欄位；舊資料未提供時會使用預設名稱，首次編輯後才寫入。
`location`、`position` 未知時填空字串。`gender` 為 `M`、`F` 或 `U`（未填寫），供兄姊弟妹稱呼使用。
`siblingOrder` 是 1 至 999 的整數，未知填 `null`；男女合併，包含自己，不再從生卒年推導。
原有示範成員的所在地、職位未提供，因此保留空白，畫面標示「未填寫」。

## 關係方向

`personId` 所指的既有成員，是這位成員的：

| type | 關係 |
| --- | --- |
| parent | 父母 |
| child | 子女 |
| grandparent | 祖父母（跨一代） |
| grandchild | 孫子女（跨一代） |
| spouse | 配偶 |
| sibling | 手足 |
| swornSibling | 契手足 |
| teacher | 師父 |
| student | 徒弟 |

`parent`、`child`、`grandparent`、`grandchild` 另外填 `kind`：親生、過繼、養子女、義子女或契子女。
例如 `{ "type": "grandparent", "personId": "p11", "kind": "契子女" }` 表示 p11 是此人的契祖父母；反向為 `grandchild`。不需要新增中間一代的成員。
直接祖孫關係相差兩代，詳情會在雙方分別列出「祖父母（直接設定）」與「孫子女（直接設定）」，並依性別顯示契祖父、契祖母、契孫子等稱呼。共同祖父母不會自動推導為手足。
例如 `teacher` 表示對方是我的師父，箭頭由對方指向我。
每筆關係只需記在一方，另一方的關係資訊由程式反向讀取，不需要手動重複儲存。
直接填手足關係不會自動假設其父母；要掛在共同父母下，請填入各位父母。
共同父母不會自動視為配偶，婚姻須另外填寫。

## 顯示與新增

每次成功載入、儲存成員／關係、修改家族名稱或匯入 JSON 後，會自動備份完整 JSON 到目前瀏覽器，無需先匯出。較小的備份使用有效期一年的 Cookie；超過 3,500 個編碼字元或 Cookie 被停用時，改用 localStorage，避免 Cookie 大小與 HTTP 標頭限制。備份讀取期限同為一年，下方狀態列會顯示實際儲存方式或失敗提示。

重新開啟時優先載入伺服器的最新檔案；若 API 無法載入，會驗證並還原瀏覽器備份，供檢視與匯出，重新連線並重新整理後可繼續編輯。瀏覽器備份不會自動覆寫伺服器資料。備份依瀏覽器、網站來源與連接埠隔離，清除網站資料或私密瀏覽結束可能移除備份。表單尚未按「儲存」的輸入不包含在完整 JSON 備份中。

階層由關係推導，不另存 `gen`：父母在上一層，子女在下一層；配偶、手足與契手足同層。
因此周文彥會與陳建國同層。師徒不決定族譜輩分；僅有師徒關係的獨立成員先放在對方同層。
若表單關係造成階層矛盾或循環，伺服器會拒絕儲存並提示修正。

點選「新增成員」填姓名、所在地、職位、性別與數字次序，再加入任意多筆關係。
姓名必填；其他基本欄位可留空，關係也可暫不填寫。每筆關係可獨立移除。
表單會用句子提示「誰是新成員的誰」，避免將師徒或親子方向填反。
儲存成功後會寫入 JSON、更新畫布並顯示新成員，重新整理或重啟伺服器後仍保留。
取消不會寫入。驗證失敗時保留表單內容；資料版本過期時按「更新資料」再檢查重送。

畫布填滿工具列下的整頁空間，支援水平／垂直捲軸、方向鍵、滑鼠及觸控拖曳。
點選成員開啟浮動關係面板；關係依父母、配偶、子女、手足、師父、徒弟分類收折，已知數字排行會顯示長兄、二姊、四弟、五妹等稱呼。右上方收合圖示可將面板縮至右側，保留選取人物與連線突顯，點選標籤可再次展開。
不同關係使用顏色、線型、端點符號與文字區分，圖例可收合；圓點才代表線條相接。

## 本機 API 與儲存

- `GET /api/family`：回傳 `{ data, version }`，version 為檔案內容雜湊。
- `PUT /api/family/name`：傳入 `{ familyName, version }`，只更新家族名稱並保留其他資料。
- `PUT /api/members/:id`：更新指定成員與關係。
- `GET /api/family/export`：匯出目前 JSON。
- `POST /api/family/import`：驗證後取代整份族譜，先建立備份。
- `POST /api/members`：傳入 `{ member, requestId, version }`；requestId 為 UUID，用於避免重試重複新增。
- 新成員 ID 由 requestId 產生。伺服器驗證參照、數字排行、重複關係與階層，再以暫存檔原子替換 JSON。
- 儲存請求逐筆處理；舊版本會收到 409，避免多個頁面互相覆蓋。
- API 僅接受本機網站的同源 JSON 提交；不公開 `.git` 或任意檔案路徑。

## 測試

```sh
npm test
```

執行全部 Node.js 回歸測試，涵蓋關係模型、成員與名稱 API、版本衝突、匯入匯出、分代背景及關係詳情。測試使用獨立暫存 JSON，不修改正式族譜。

```sh
npm run test:browser
```

瀏覽器整合測試需要 Python Playwright 與 Chromium（測試腳本預設使用 `/usr/bin/chromium`，可依本機環境調整）。本測試環境限制直接導覽本機網址，因此腳本會從磁碟載入 HTML／JS，並透過 Python 將瀏覽器 API 請求轉送至使用獨立 JSON 的真實 Node 伺服器。涵蓋桌面與手機版的名稱儲存、衝突處理、收合、鍵盤、重繪與既有編輯入口。一般網站執行不需要 Playwright。

舊版 `node tests/relationships.cjs` 是獨立的歷史瀏覽器測試，範例人數斷言尚未同步更新，不列入目前回歸測試指令。

## 家族名稱（schema v2 相容）

族譜根物件可加入 `familyName`，例如：

```json
{
  "schemaVersion": 2,
  "familyName": "陳氏家族",
  "people": []
}
```

舊 JSON 未提供 `familyName` 時顯示「陳氏家族」，不需要轉換版本。點選頁面標題旁的鉛筆圖示可編輯名稱，儲存後同步更新頁面標題與 JSON。名稱必須是非空字串，去除前後空白後最多 80 個字元，不允許控制字元。修改只更新根層名稱，保留成員、關係及其他資料；不需要重新匯入或覆蓋現有 JSON。

`PUT /api/family/name` 接受 `{ "familyName": "新名稱", "version": "目前版本" }`，使用既有同源檢查、寫入佇列、版本衝突回應及原子寫入。舊版本回傳 409，使用「更新目前資料」可保留輸入內容並重新確認。匯出包含已儲存名稱；匯入會取代整份族譜，包含家族名稱，舊版無名稱檔案會回到預設名稱。

## 關係詳情側邊收合

關係詳情右上方有收合圖示，可將面板縮成畫布右側的窄標籤，保留目前選取的人物與連線突顯。點選標籤即可展開；再次點選人物會展開其詳情。收合不等於關閉，原有 × 仍可關閉面板並取消選取。收合狀態在重繪及視窗大小變更後保留，分類收折和手足排行功能不受影響。

## 本次修改檔案

本次補丁以分代背景版本為基礎，包含 `family-tree.html`、`assets/family-model.js`、`assets/family-tree.js`、`assets/member-form.js`、`assets/relationship-details.js`、`server.cjs`、`package.json`、`README.md` 及新增／更新的測試。沒有修改 `data/family.json`、世代背景模組或既有關係儲存邏輯。覆蓋檔案後重新啟動伺服器並強制重新整理瀏覽器，首次修改家族名稱時會自動新增根層 `familyName`。
