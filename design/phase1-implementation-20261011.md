# 第一階段實作紀錄

日期：2026-10-11。範圍：共用基礎與差異比較。

## 已交付

| 項目 | 原本 | 第一階段完成後 |
| --- | --- | --- |
| 資料版本 | v2 | 可讀 v2／v3，寫入／匯出 v3，保留 v2 原始備份 |
| 成員生命週期 | 無共用操作 | 封存、解除封存、移至回收區、還原的純資料命令與版本化預覽 |
| 差異比較 | 中文文字清單 | 穩定 ID、雙向關係正規化、逐欄新舊值、摘要、搜尋、分類與系統資料展開 |
| 確認狀態 | 表單只保存 pending | 保留 confirmed／pending，新增預設未標記，舊資料不自動補 confirmed |
| 關係證據 | 各介面自行解讀 | 共用直接／推導來源與證據路徑確認狀態規則 |

結構化比較已接入雲端衝突、成員合併與既有匯入預覽。雲端仍選擇整份「此裝置／Google Drive」版本；成員合併仍保留原來的欄位選擇。手機尺寸採同一差異的舊值／新值上下排列，不只依靠顏色表達變更。

封存／回收區的正式操作入口、清單與地圖可見性，以及待整理工作台屬於第二階段；本階段提供其共用核心。第三階段再將證據提示全面套用到畫布、詳情與查詢。

## 模組

- `src/assets/family-schema.js`：版本驗證及無損格式升級。
- `src/assets/family-lifecycle.js`：生命週期資料驗證、影響預覽、引用清理及還原衝突。
- `src/assets/relationship-evidence.js`：正反向穩定關係鍵、原始記錄與證據路徑狀態。
- `src/assets/family-diff.js`：結構化比較及 `FamilyModel.dataDifferences()` 相容文字輸出。
- `src/assets/family-diff-view.js`／`family-diff.css`：共用比較介面。

所有寫入經既有 FamilyApp → FamilyRepository → FamilyCommands／FamilyModel。IndexedDB 的資料庫名稱與 store 維持原值，以直接讀取既有資料。

## 遷移及備份

首次讀取已保存的 v2 資料時，使用同一 IndexedDB transaction 保存原始資料、寫入 v3、更新版本與同步 dirty 標記。任一寫入失敗就 abort，不採用新 snapshot。格式升級不新增復原步驟；原有歷史仍保留，復原 v2 歷史時會升級成 v3。

備份 API：`await FamilyApp.getSchemaBackup(kind)`。`kind` 為 `local`（預設）、`import` 或 `cloud`，有備份時回傳包含 `data` 的物件，無備份時回傳空值。`data` 保留原始 v2 JSON，不補推導關係。

| IndexedDB record | 行為 |
| --- | --- |
| `schema-v2-backup` | 保留首次本機升級前的資料，不因後續修改覆蓋 |
| `schema-v2-import-backup` | 保留最近一次 v2 匯入原檔，與原有匯入前備份分開 |
| `schema-v2-cloud-backup` | 保留最近一次下載的 v2 雲端原檔 |

開發 adapter 保存 `<dataFile>.schema-v2.backup.json` 與 `<dataFile>.schema-v2.import.backup.json`；備份失敗時不覆寫目前族譜。開發模式沒有 Drive 備份。正式部署的備份存在此裝置的 IndexedDB，完整 JSON 匯出仍是使用者可攜備份。

## 生命週期 API

先取得預覽並展示差異與衝突，提交必須帶同一份預覽的版本：

```js
const command = { type: 'deleteMember', id: memberId };
const preview = await FamilyApp.previewLifecycle(command);
// 使用 preview.differences、affectedPersonIds 與 conflicts 呈現影響。
if (preview.canApply) {
  const saved = await FamilyApp.lifecycleCommand({ ...command, version: preview.version });
  // 第二階段 UI 將在此同步編輯器、選取與導覽狀態。
}
```

四種命令為 `archiveMember`、`unarchiveMember`、`deleteMember`、`restoreMember`。封存可附 `reason`，時間預設使用目前時間。預覽不寫入；版本改變時提交回傳 409。

刪除保留成員、所有入向／出向關係、排行群組引用與相關忽略紀錄，清理現有資料的引用，重新計算推導關係，不自動接上原先兩端人物。回收資料參與 JSON 與 Drive 整份版本往返。

還原重新驗證目前資料，不以舊整份快照覆蓋新修改。成員 ID 已被使用時不能還原；關係對象不存在、群組缺少／類型改變／anchor 改變、排行占用或其他領域衝突會列在 `conflicts`。可明確提供 `omitRelationships`（預覽中的穩定關係鍵）與 `omitGroups`（群組 ID），再次預覽、再次驗證後提交；略過群組時只移除所還原關係的對應 `groupId`。不提供自動永久清除。

## 證據與差異規則

直接記錄不等於已確認。正反向記錄有 pending 時優先提示待確認，其餘有明確 confirmed 才顯示已確認，全部未填則未標記。推導關係按目前提供的完整路徑彙整：全為 confirmed → 依據已確認，含 pending → 依據待確認，其餘 → 依據未完整標記。無路徑不推定為已確認。

既有自動推導仍排除 pending 作為依據。本階段的共用模組不改變推導政策。

差異保留擴充欄位、關係 metadata、排行、封存及回收紀錄；不比較重建的 `inferredRelationships`。僅搬移關係存放方向不產生假差異，confirmed 與未標記仍有差異。同名成員在比較中補上 ID；雙向記錄存在矛盾時顯示全部值。

## 驗證

- 全量 Node 測試：193 項通過（含 15 項新增的純資料與 dev API 情境）。
- `tests/browser-phase1.cjs`：正式靜態建置、IndexedDB 升級交易失敗／恢復、三類備份、歷史復原、confirmed 表單往返、生命週期預覽／過期拒絕／刪除／還原、重載及模擬雲端 JSON 往返，桌面／手機尺寸比較、搜尋篩選與文字安全。
- 既有 `browser-relationship-policy.cjs`、`browser-family-inference.cjs`：API／靜態模式、成員合併、整份雲端衝突、過期雲端拒絕、親屬推導。
- 既有 `browser-static.cjs`、`browser-static-storage-errors.cjs`、`browser-device-reset.cjs`：JSON 往返、無變更雲端同步表單、跨分頁、儲存錯誤恢復、裝置重設。
- `node dev/build.cjs`：靜態發布輸出成功，不包含示範族譜；與 `npm run build` 使用同一建置程式，本環境未提供 npm 命令。

新增測試可用 `npm run test:phase1:browser` 執行，需要 Playwright 與可用的 Chromium／Edge。`PLAYWRIGHT_MODULE` 可指定套件路徑，`PLAYWRIGHT_CHANNEL`／`PLAYWRIGHT_EXECUTABLE` 可指定瀏覽器。

本階段瀏覽器驗證為 Edge 的桌面及手機尺寸模擬；Drive 使用模擬回應，沒有操作真實帳號。手機硬體與正式 OAuth 驗收保留至整合階段。
