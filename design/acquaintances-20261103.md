# 認識關係

新增 `acquaintance` 關係，表單顯示「認識」。它是雙向的直接記錄，可從任一方編輯、移除，保留選填的來源與說明，沿用既有 JSON、儲存及復原流程。

## 顯示規則

- A 認識 B，A 沒有親屬關係時，A 暫時放在 B 同一代，卡片使用虛線邊框。詳情另列「朋友」，關係線標示「認識」。
- 畫布上的「認識」連線、標籤與來源標記預設隱藏；查看任一端成員的詳情時顯示該成員的認識關係。關閉詳情或改看無關成員會再次隱藏，顯示推導開關不會開啟這些線。
- 親屬關係以既有親子、祖孫、婚姻、手足、契手足、堂表親、叔伯姑姨舅／姪甥與家族排行群組判定，包含從對方記錄的反向關係。師徒與同門不視為親屬。
- 補上親屬關係後恢復實線卡片，代別依原有親屬排版；認識不限制親屬代差、不建立契手足，也不作為親屬推導依據。移除親屬關係或復原時重新計算。
- 認識多人且代別不同時，優先由較早代別安排；同代以穩定 ID 排序，可沿認識鏈安排其他無親屬者。已有親屬者不移動。雙方皆無親屬時，兩者都標示非家族成員。
- `nonFamily` 與暫定代別只存在顯示投影，不寫回來源資料。篩選、查詢及 SVG／列印沿用卡片狀態。

## 驗證

Windows、Node v24.21.0，瀏覽器使用 Playwright 與本機 Edge。

- `node --test tests/acquaintances.test.cjs`：5 項，涵蓋雙向／逆序資料、親屬優先、認識鏈、多位對象、來源不變、查詢／詳情／依據及輸出虛線。
- `npm test`：284 項通過。
- `node tests/browser-acquaintances.cjs`：API／瀏覽器儲存，各以 1280／390 寬度測試新增與編輯、反向編輯、同代與虛線、重新載入、親屬優先、復原、SVG。
- 既有 `browser-peer-generations.cjs`、`browser-relationship-policy.cjs`、`browser-phase4.cjs` 回歸，以及 `npm run build`、`npm run check:release`。

執行時以 `PLAYWRIGHT_MODULE` 指向環境既有的 Playwright。紀錄在 `.codebase-memory/acquaintances-*.log`，新流程截圖與 SVG 在 `.codebase-memory/acquaintances-results/`。測試使用暫存資料，不更動 `fixtures/family.json`。手機為尺寸模擬，未執行手機實機驗收；未發布。

連線預設隱藏的追加驗證：284 項 Node 測試通過；`browser-acquaintances.cjs` 在 API／本機儲存及 1280／390 寬度驗證線段、標籤、來源標記在關閉詳情、查看無關成員、重新載入及兩人查詢時隱藏，查看任一端詳情時顯示。`browser-mixed-sharing.cjs` 的六種環境各 9 個既有連線案例通過，建置與發布包檢查通過。紀錄在 `.codebase-memory/acquaintance-visibility-*.log`。
