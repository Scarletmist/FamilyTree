# 族譜網站

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

根物件為 `{ "schemaVersion": 2, "people": [...] }`。
`location`、`position` 未知時填空字串。`gender` 為 `M`、`F` 或 `U`（未填寫），供兄姊弟妹稱呼使用。
`siblingOrder` 是 1 至 999 的整數，未知填 `null`；男女合併，包含自己，不再從生卒年推導。
原有示範成員的所在地、職位未提供，因此保留空白，畫面標示「未填寫」。

## 關係方向

`personId` 所指的既有成員，是這位成員的：

| type | 關係 |
| --- | --- |
| parent | 父母 |
| child | 子女 |
| spouse | 配偶 |
| sibling | 手足 |
| swornSibling | 契手足 |
| teacher | 師父 |
| student | 徒弟 |

`parent`、`child` 另外填 `kind`：親生、過繼、養子女、義子女或契子女。
例如 `teacher` 表示對方是我的師父，箭頭由對方指向我。
每筆關係只需記在一方，另一方的關係資訊由程式反向讀取，不需要手動重複儲存。
直接填手足關係不會自動假設其父母；要掛在共同父母下，請填入各位父母。
共同父母不會自動視為配偶，婚姻須另外填寫。

## 顯示與新增

階層由關係推導，不另存 `gen`：父母在上一層，子女在下一層；配偶、手足與契手足同層。
因此周文彥會與陳建國同層。師徒不決定族譜輩分；僅有師徒關係的獨立成員先放在對方同層。
若表單關係造成階層矛盾或循環，伺服器會拒絕儲存並提示修正。

點選「新增成員」填姓名、所在地、職位、性別與數字次序，再加入任意多筆關係。
姓名必填；其他基本欄位可留空，關係也可暫不填寫。每筆關係可獨立移除。
表單會用句子提示「誰是新成員的誰」，避免將師徒或親子方向填反。
儲存成功後會寫入 JSON、更新畫布並顯示新成員，重新整理或重啟伺服器後仍保留。
取消不會寫入。驗證失敗時保留表單內容；資料版本過期時按「更新資料」再檢查重送。

畫布填滿工具列下的整頁空間，支援水平／垂直捲軸、方向鍵、滑鼠及觸控拖曳。
點選成員開啟浮動關係面板；已知數字排行會顯示長兄、二姊、四弟、五妹等稱呼。
不同關係使用顏色、線型、端點符號與文字區分，圖例可收合；圓點才代表線條相接。

## 本機 API 與儲存

- `GET /api/family`：回傳 `{ data, version }`，version 為檔案內容雜湊。
- `POST /api/members`：傳入 `{ member, requestId, version }`；requestId 為 UUID，用於避免重試重複新增。
- 新成員 ID 由 requestId 產生。伺服器驗證參照、數字排行、重複關係與階層，再以暫存檔原子替換 JSON。
- 儲存請求逐筆處理；舊版本會收到 409，避免多個頁面互相覆蓋。
- API 僅接受本機網站的同源 JSON 提交；不公開 `.git` 或任意檔案路徑。

## 測試

```sh
node --test tests/server.test.cjs
node tests/relationships.cjs
```

第一項不需要額外套件。第二項需 Playwright 與 Microsoft Edge；可用 `PLAYWRIGHT_MODULE` 指向既有的 Playwright，
並用 `BROWSER_CHANNEL` 指定其他已安裝的 Chromium 通道。
測試使用獨立暫存 JSON，涵蓋實際表單新增、多筆關係、錯誤後保留內容、檔案持久化、重啟、並行儲存、取消、手機表單與拖曳，
不會把測試成員寫進正式資料。
