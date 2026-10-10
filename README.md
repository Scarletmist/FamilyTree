# 族譜網站

## 成員所在地地圖

成員表單的所在地可填公開地名，例如「新竹天公壇」「新竹關帝廟」。新增／儲存後會自動排入 Nominatim 定位佇列；既有、匯入或雲端下載的成員尚無有效座標時，也會在背景逐筆補齊。透過桌面「地圖」或手機「更多 → 成員地圖」查看；同座標成員共用標記，縮小地圖時鄰近地點會合併為圓形數字標記，數字代表成員總數。標記與清單連動選取，選取位置有外圈及清單高亮；清單可篩選地點／姓名，點選姓名開啟摘要，再由摘要進入完整成員詳情或修正位置。地圖使用 MIT 授權的 Pigeon Maps 0.22.1，不需要 API Key。

- 右上角的圖層圖示集中提供「OpenStreetMap 街道圖」「Google 衛星圖」與「合併鄰近標記」選項及勾選狀態。預設街道圖，以本機 localStorage 記住底圖偏好，不寫入族譜、同步資料或復原紀錄；禁止 localStorage 時仍可切換。切換只更換圖磚，保留地圖位置、縮放、成員標記、群組、候選選擇與中央準星。底圖載入失敗可直接按提示切回街道圖。
- 預設合併鄰近地點；取消後直接顯示各座標的標記，相同座標的成員仍共用標記並顯示人數。修正時保留瀏覽的群組選擇，候選地圖固定顯示個別標記；重新開啟地圖預設啟用群組。最大縮放層級仍合併的群組，hover 列出所在地與成員，也能直接點擊：桌面顯示區域清單，手機顯示於底部面板，不再提示放大。
- 桌面使用右側清單，手機直向使用可拖曳、點擊或以方向鍵調整的底部面板，有收合／中間／展開三段高度。拖曳即時跟隨，放開後以可中斷的彈簧收合；減少動態效果及鍵盤操作直接切換。準星與縮放以面板上方的可見地圖為中心。已定位／待定位數量為精簡入口，點擊後列出待處理原因、修正、重查與裝置接手操作；隱私排除的成員另以收合區塊列出。
- 點擊個別標記或清單地點聚焦時，預設縮放至 15；目前縮放更高時保留該層級。地點修正的候選標記也沿用此規則。成員地圖清單的姓名按鈕右上角以綠色圓點表示已手動修正位置，滑鼠提示及讀屏名稱保留狀態說明，不另佔文字標籤空間。

- 查詢單一執行、一般間隔 15 秒；網路錯誤、HTTP 錯誤、逾時或無效回應會在失敗後等 5 秒重試。查無地點／多筆同名且無法辨識時保存該狀態，不會每 5 秒重查；可補充所在地或在地圖清單按「重新查詢」。不做輸入中的即時搜尋。
- 結果以選填的 `people[].geocode` 保存，包含原查詢、`provider: "nominatim"`、`status`、查詢時間；成功結果另有 `lat`／`lon`、顯示名稱、OSM 物件類型與 ID。沿用 schemaVersion 2、IndexedDB、JSON 匯入／匯出及整份 Google Drive 同步。另以 IndexedDB 快取相同地名（包括查無結果），減少重新載入、匯入及多位成員的重複請求。
- `people[].mapHidden: true` 代表私人住址／不在地圖顯示，會在發送查詢前排除。疑似完整門牌地址也保守排除；文字判斷不能涵蓋所有私人住址，請使用此選項。查詢只送所在地，不傳姓名、關係或其他族譜資料。
- 修改所在地或隱私設定會清除不適用的座標。結果寫入時在同一資料 transaction 內重新比對目前所在地與隱私設定，避免舊請求覆蓋新資料；背景寫入不佔用復原歷史，維持尚未儲存表單內容與有效版本。
- 成員詳情的公開所在地文字可點擊，已有有效自動／手動座標時開啟成員地圖並聚焦該成員，尚無座標時直接開啟地點設定；私人住址／不顯示於地圖的成員維持純文字。成員詳情不再提供獨立修正圖示，已有位置可透過地圖清單的地點修正圖示修改。修正時可補充地名、按放大鏡查詢後選擇候選地點，或切換至準星圖示，移動地圖以紅色、白框中央準星指定公開位置，再按勾選圖示儲存。切換搜尋與地圖指定模式會保留同一個地圖、中心與縮放層級，可先搜尋縮小範圍，再用準星微調。修正、查詢、重查、恢復自動定位與儲存等操作使用圖示，保留提示文字與讀屏名稱；候選地圖保留個別標記供選擇。搜尋只在按鈕提交時執行，候選結果也會快取；與背景查詢共用分頁鎖及查詢間隔，服務失敗後等 5 秒重試，關閉修正視窗或切換方式會取消查詢。
- 瀏覽與修正共用同一張地圖及對話框，右上角保留一致的關閉按鈕；修正時左上返回瀏覽，恢復原地圖位置、縮放、清單篩選與捲動。已有位置預設準星模式，未定位預設搜尋；開啟時不自動聚焦輸入框。搜尋／準星切換保留地圖及候選選取。「恢復此成員的自動定位」放在底部更多選單；儲存後地圖內有結果與復原入口，使用既有版本檢查，避免覆蓋後續編輯。
- 有其他成員填寫相同所在地時，預設勾選「一併套用至相同所在地成員」，儲存會一次修正所有符合隱私規則的同地點成員；比對會整理空白並視「臺／台」為相同。介面顯示預計套用人數，展開「查看影響成員」列出姓名及已有手動位置的覆蓋提示。取消勾選只修正目前成員，各成員仍可獨立編輯；「恢復自動定位」也只影響目前成員。整批修正是一項可復原操作；開啟後同組成員、所在地、隱私或手動位置有變更時，儲存會要求重新開啟，不會套用過期資料。
- 修正保存於各成員選填的 `people[].locationOverride`，包含原所在地、來源 `nominatim`／`map`、座標、顯示名稱與修正時間；候選選擇另記錄查詢文字與 OSM 物件，地圖指定不虛構 OSM 身分。原所在地文字不變，手動修正優先於 `geocode`，不寫入共用的自動定位快取。修正及「恢復自動定位」都支援復原、JSON 匯出／匯入與 Google Drive 同步；普通姓名／關係修改保留修正，所在地或隱私改變則清除不適用的修正。私人住址仍排除。同所在地但修正座標不同的成員，須先統一或取消修正才能合併。
- 根物件選填的 `locationLookupDeviceId` 指定這份族譜的背景定位裝置。第一台有待定位成員的裝置自動接手；其他裝置可在地圖按「由此裝置接手定位」。同 origin 分頁以 Web Locks 協調；不支援 Web Locks 的瀏覽器仍可編輯與查看地圖，但不自動查詢。分頁隱藏、離線或編輯表單開啟時暫停；**關閉網站後不會在背景執行**。
- 定位由系統自動處理，不提供使用者調整查詢服務或開關的介面。查詢服務預設為 `https://nominatim.openstreetmap.org/search`，維護者可修改部署的 `data/location-config.json` 切換到允許此負載的 HTTPS Nominatim search 服務，不必更改 JavaScript；每次實際查詢會讀取設定。街道圖磚為 `https://tile.openstreetmap.org/{z}/{x}/{y}.png`，衛星圖使用 `https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}`，依座標分配至 `mt0`～`mt3`；此免 Key 網址並非正式 Maps Platform API 介面，供應端可變更存取方式。只有開啟地圖才載入，關閉時卸載，不預抓離線圖磚。衛星圖顯示 Google Maps 來源，所在地查詢仍使用 Nominatim 並保留 OpenStreetMap contributors 標示。

公共 Nominatim 適用少量使用，要求來源識別、快取與 ODbL 標示；全網站總流量限制為每秒 1 次，規律背景查詢限制為每分鐘 4 次。裝置接手機制需靠既有 JSON 同步傳播，純靜態部署無法在不同使用者或離線裝置之間提供伺服器級全域限流；使用者增加時請改用自行管理或允許此負載的 Nominatim 服務。[查詢政策](https://operations.osmfoundation.org/policies/nominatim/)／[圖磚政策](https://operations.osmfoundation.org/policies/tiles/)。公開地圖需保留 OpenStreetMap contributors 的來源連結。

地圖執行套件已固定版本、連同 MIT 授權文字存入 `src/assets/vendor/`，一般 `node dev/build.cjs` 不需安裝套件。更新套件才需在 `dev/map-runtime/` 執行 `pnpm install --frozen-lockfile` 與 `node build.cjs`；原始包裝元件保留在 `map-runtime.jsx`。瀏覽器測試：`node tests/browser-locations.cjs`、`node tests/browser-location-corrections.cjs`、`node tests/browser-map-workspace.cjs`（或 `npm run test:locations:browser`），使用模擬查詢與圖磚，不會向公共服務發送測試請求。工作區測試涵蓋選取、單一地圖、返回、範圍預覽、版本保護與復原、面板拖曳、減少動態效果及手機區域清單。手機鍵盤、瀏覽器工具列與實際觸控仍需 iOS／Android 實機驗證。

## 關係與操作擴充

- 手足、契手足可先記錄相對長幼，數字排行未知時留空即可。後續填入有效排行會顯示二兄、三妹等具體稱謂；排行和既有長幼衝突、反向記錄矛盾或長幼形成循環時禁止儲存，表單會展開並定位到相關關係。契手足不使用原生家庭排行。
- 成員詳情的「新增親屬」可帶入對象與正確關係方向；關係表單同時預覽雙向稱謂。稱謂旁的「補填」可補性別、長幼或排行群組。已由共同父母推導的手足也可直接補上長幼。
- 詳情區分直接設定與推導依據。共有一位父母但另一方不明時，只標示共有父親／母親；雙方不同的另一位親生父母都有記錄時，才顯示同父異母／同母異父。親生、收養及過繼的依據保留在說明中，不假設未記錄的父母。
- 每筆關係可選填 `note`（說明）、`source`（來源），各最多 2000 字；`status` 可為 `confirmed` 或 `pending`，省略代表未加待確認標記。反向編輯保留這些資訊，查詢路徑會標示待確認關係及來源。
- 成員清單提供「排行群組」「合併重複成員」及固定的復原入口。合併須逐欄選擇、預覽變更後確認；自我關係、相互矛盾的關係、不同群組排行或衝突的擴充欄位會阻止合併。不以同名自動合併。
- 匯入與 Google Drive 衝突視窗列出新增／移除成員、欄位及關係差異。同步衝突預覽後會再檢查本機與遠端版本，資料有變時需重新檢視差異。
- 搜尋選單使用至少 16px 輸入字級，依可視範圍調整位置與高度；鍵盤導航只捲動選項清單，避免把整頁帶走。

### 相對長幼與群組資料

既有 schemaVersion 2 資料可直接載入，新增欄位皆為選填；不會自動把相對長幼轉成數字。`seniority` 仍代表**關係對象**相對於記錄者的長幼，例如：

```json
{ "type": "sibling", "personId": "older-member", "seniority": "older", "status": "pending", "source": "家族訪談" }
```

根物件的 `rankGroups` 可記錄不同家庭、結拜或師門排行：

```json
{
  "rankGroups": [{
    "id": "school-one",
    "name": "甲師門",
    "type": "fellowDisciple",
    "anchorId": "teacher-id",
    "members": [{ "personId": "member-a", "order": 1 }, { "personId": "member-b", "order": null }]
  }]
}
```

類型為 `sibling`、`swornSibling` 或 `fellowDisciple`；`order` 為 1–999 或 `null`，同組不可重複已知排行。選填的 `anchorId` 指所屬父母／師父，供子女／徒弟的排行顯示；群組本身不會建立親屬關係。成員在某類型已有群組時，不再套用該類型的一般排行。同一對成員有多個共同群組時，可在關係的 `groupId` 指定群組，未指定則保留不確定提示。

一般 `siblingOrder` 與 `discipleOrder` 仍保留，供未使用群組的既有資料使用。新版可讀取舊資料；含新關係欄位的匯出檔請使用新版程式開啟。

管理操作由瀏覽器端的 `FamilyApp` 以語意化 command 呼叫（例如排行群組、合併與復原），正式 GitHub Pages 執行路徑不依賴 REST API。資料變更由 `FamilyCommands` 與 `FamilyModel` 共用驗證，並由 `FamilyRepository` 在 IndexedDB 單一 readwrite transaction 內完成版本檢查、資料寫入、復原歷史與 sync dirty 標記。固定復原入口仍保留。僅本機開發伺服器提供相容的 `/api/*` adapter，方便既有開發與 server 測試；其歷史維持於記憶體、重啟後清空。

驗證指令：`node --test tests/*.test.cjs`、`node tests/browser-static.cjs`、`node tests/browser-relationship-policy.cjs`。瀏覽器測試可用 `PLAYWRIGHT_MODULE` 指定 Playwright 位置、`PLAYWRIGHT_CHANNEL` 指定瀏覽器。新測試涵蓋開發與靜態模式、群組、合併／復原、匯入差異、模擬 Google Drive 衝突，以及直向／橫向／平板與模擬鍵盤可視區域。這些模擬不取代 iOS 實機鍵盤驗證。

## 專案目錄

- `src/`：唯一的 production source。`family-tree.html` 是精簡頁面 shell，`assets/family-tree.css` 保存樣式，`templates/dialogs.html` 保存 dialog markup；`assets/` 與 `data/kinship-terms.json` 都會進入正式靜態站。
- `dev/`：只供開發與建置使用，包含 `server.cjs`、`build.cjs` 與 `site-source.cjs`。這些檔案不會發布到 GitHub Pages。
- `fixtures/`：測試／本機 dev adapter 的示範族譜資料。`fixtures/family.json` 永遠不會被 build 複製到 `dist/`。
- `tests/`：Node 與瀏覽器回歸測試。
- `dist/`：由建置產生的唯一發布輸出，不應手動維護。

## 互動動畫

成員詳情開合、dialog、手機關係結果面板、儲存／復原提示與搜尋選單使用原生 CSS 過場。動畫只處理 opacity／transform；畫布尺寸與視角錨點立即更新，拖曳、縮放、搜尋結果與連續查看成員維持原有操作。視窗退出使用 display／overlay 的離散過場，關閉狀態與焦點不等待動畫。

`family-motion.js` 區分指標與鍵盤輸入，鍵盤啟動及操作會立即切換並取消進行中的過場。`prefers-reduced-motion: reduce` 改為 80ms 純淡入淡出；未支援離散過場的瀏覽器使用原有即時切換。

`npm run test:motion:browser` 驗證桌面、手機直橫向、減少動態、快速重開、焦點、成員切換、選單、提示／復原及族譜資料不變；可用 `PLAYWRIGHT_MODULE`、`PLAYWRIGHT_CHANNEL` 指定 Playwright 與瀏覽器。

## 靜態建置與 GitHub Pages

執行 `node dev/build.cjs`（或 `npm run build`）產生 `dist/`，首頁為 `dist/index.html`，也保留 `family-tree.html` 入口。不需安裝套件。建置只從 `src/` 複製 production runtime，並在建置時展開 `src/templates/`；**不包含 `fixtures/family.json`、`dev/`、source templates 或任何開發成員資料**。

靜態網站首次開啟為空白族譜，可直接新增成員或匯入自己的 JSON。新增、修改、家族名稱與匯入內容都先儲存在該網站路徑的 **IndexedDB**；重新整理與離線時仍可讀寫。舊版曾儲存在 `localStorage` 的族譜與「匯入前備份」會在第一次載入時自動遷移至 IndexedDB，成功後移除舊鍵。JSON 匯入／匯出功能仍保留，可作為人工備份與資料搬移方式；清除瀏覽器網站資料仍會刪除本機 IndexedDB。

靜態版可選擇連結 Google Drive，將**現有完整 JSON 格式原樣**同步到使用者自己的 Drive `appDataFolder`，因此不需要自建資料庫或 Backend。Google Drive 未設定、未授權、授權過期或暫時離線時，族譜仍以 IndexedDB 正常運作。

已提供 `.github/workflows/pages.yml`，只在手動執行時發佈：

1. 將程式放進 GitHub repository，至 Settings → Pages 將 Source 設為 GitHub Actions。
2. 在 Actions 選擇 **Publish GitHub Pages**，按 **Run workflow**。
3. 工作流程會執行測試、建置並上傳 `dist/`，部署完成後提供網站網址。

資源採相對路徑，支援 `https://帳號.github.io/專案名稱/`。設定方式參照 [GitHub Pages 官方工作流程文件](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。目前僅建立建置與部署設定，未替 repository 開啟 Pages 或執行遠端發佈。

正式執行架構以瀏覽器為中心：`FamilyApp` 保存目前 application snapshot 與衍生 graph，`FamilyCommands` 定義純資料 mutation，`FamilyRepository` 將 **IndexedDB 視為 primary store**。Google Drive 是選用的 remote replica：`family-sync-engine.js` 負責 local/remote 版本決策與衝突流程，`google-drive-client.js` 只負責 Drive `appDataFolder` I/O，而 `google-drive-sync.js` 留下 OAuth、排程與同步 UI。請透過 HTTP/HTTPS 靜態伺服器預覽 `dist/`，不要直接雙擊 HTML。

### Google Drive 跨裝置同步設定

同步採用 [Google Identity Services Token Model](https://developers.google.com/identity/oauth2/web/guides/use-token-model) 與 [Google Drive `appDataFolder`](https://developers.google.com/workspace/drive/api/guides/appdata)。`drive.appdata` 只允許本應用存取自己的隱藏應用資料，`family-tree.json` 不會顯示在一般 Google Drive 檔案清單，也不能用一般 Drive 分享功能分享給其他帳號。

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 建立或選擇一個 Project。
2. 啟用 **Google Drive API**。
3. 在 **Google Auth Platform** 設定 OAuth consent screen / Audience。若目前只供自己或少數人測試，可維持 Testing，並把會使用的 Google 帳號加入 Test users；日後要公開給一般使用者時，再依 Google 當時的 Production / verification 要求完成設定。
4. 到 **Google Auth Platform → Clients → Create Client**，Application type 選 **Web application**。
5. 在 **Authorized JavaScript origins** 加入網站的 origin。若正式網址是 `https://scarletmist.github.io/FamilyTree/`，填的是 `https://scarletmist.github.io`，**不要包含 `/FamilyTree/` 路徑**。若另有自訂網域，也加入該 HTTPS origin。
6. 建立後取得 `xxxxxxxx.apps.googleusercontent.com` 格式的 **Client ID**。此純前端 Token Model 不需要把 Client Secret 放進網站。
7. 到 GitHub repository → **Settings → Secrets and variables → Actions → Variables**，新增 Repository variable：

   ```text
   GOOGLE_OAUTH_CLIENT_ID = xxxxxxxx.apps.googleusercontent.com
   ```

8. 重新執行 **Publish GitHub Pages**。建置程式會把 Client ID 注入 `dist/index.html` 與 `dist/family-tree.html` 的 `<meta name="google-oauth-client-id">`。

也可以在本機測試建置時指定：

```sh
GOOGLE_OAUTH_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com npm run build
```

未設定 Client ID 時建置仍會成功，網站仍可完整使用 IndexedDB；「雲端」視窗會顯示尚未設定 Google OAuth Client ID，而不會影響本機資料。

### 同步行為

- 本機 **IndexedDB 是主要工作資料**。每次成功修改族譜後先立即寫入本機，再在已有有效 Google Access Token 時延遲約 1.8 秒同步。
- 第一次同步且 Drive 尚無資料時，建立 `appDataFolder/family-tree.json`；新裝置的本機仍是空白族譜時，會直接下載 Drive 版本。
- 已同步過的裝置會記錄 Drive 檔案 ID 與 Drive `version`。當偵測到遠端版本變更且本機也有未同步修改時，會顯示衝突視窗，讓使用者選擇「下載 Google Drive 版本」或「以此裝置版本覆蓋雲端」，不會在已偵測到衝突時自動選邊。
- 開啟頁面、重新聚焦、恢復網路及頁面可見時，若目前仍持有有效 Access Token 會檢查遠端；頁面保持開啟時也會每分鐘檢查一次。
- Access Token 會在目前瀏覽器分頁的 **sessionStorage** 中暫存到 Google 回傳的到期時間，因此同一分頁重新整理後可恢復尚未過期的 Token 並自動同步；Token 不會寫進 IndexedDB/localStorage。關閉分頁、瀏覽器清除 sessionStorage、Token 過期或 Google 回傳 401 後，仍需由使用者再次按「重新授權並同步」。純前端 Token Model 沒有 Refresh Token，無法在 Token 過期後完全無互動續期。
- 「中斷連結」會清除記憶體與 sessionStorage 中的 Access Token、本機連結狀態並停止自動同步；程式不會呼叫 Drive 刪除 API。若要完全撤銷此網站的 Google 帳戶授權，請在 Google 帳戶的第三方應用程式存取權設定中移除。
- 無法讀取本機同步狀態時，「雲端」視窗會提供「強制重置此裝置資料」。確認後會停止此瀏覽器各族譜分頁的同步，清除此網站的本機族譜、未同步變更、復原紀錄、備份、快取、編輯草稿及暫存授權，再重新載入；此操作無法復原。重置不會呼叫 Google Drive 的新增、修改或刪除 API，也不會清除其他裝置資料。完成後可重新連結同一帳號，下載原有雲端族譜；若其他分頁仍占用資料庫，畫面會提示先關閉分頁，待清除成功後才重新載入。
- 目前同步單位是一整份 JSON，不是多人即時協作資料庫。若兩個裝置幾乎在同一瞬間各自完成上傳，Google Drive API 並沒有被本專案當成原子 compare-and-swap DB 使用，因此仍建議避免在兩台裝置同時編輯；版本檢查是衝突保護，而不是 Google Docs 類型的即時合併。

靜態整合測試：`npm run test:storage:browser`（需 Node 版 Playwright，可用 `PLAYWRIGHT_MODULE` 指定位置）。測試涵蓋專案子路徑、空白起始、IndexedDB 重新載入、備註、新增修改、匯入匯出、跨分頁版本衝突、儲存失敗重試與裝置重置。重置測試以模擬 Drive 驗證取消、失敗、分頁占用、資料清除及重新下載，並確認沒有雲端寫入；可用 `PLAYWRIGHT_EXECUTABLE` 指定 Brave 等 Chromium 瀏覽器。Google OAuth / Drive 真實帳號授權不會放進自動化測試，避免測試環境持有使用者憑證。

## 兩人關係查詢與稱謂設定

選擇 A 與 B，按「查詢兩人關係」。B 是稱呼基準，結果顯示「A 為 B 的……」。畫布僅顯示所選路徑上的成員與連線，例如堂親會保留兩人的父親，以及資料中用來連接父親的共同祖先。「交換 A／B」可查看反向稱呼，「顯示全部」可回到完整族譜；查詢不會改寫成員 JSON。

稱謂及規則儲存在 `src/data/kinship-terms.json`。網頁啟動時自動讀取建置後的 `data/kinship-terms.json`，修改 source 後重新建置／重新整理即可生效，無需修改 JavaScript。載入或格式錯誤時會顯示重試按鈕，原有族譜仍可使用。稱謂依據[教育部《國語辭典簡編本》親朋稱呼表](https://dict.concised.moe.edu.tw/appendix.jsp?ID=12&la=1&powerMode=0)，來源網址與查核日期也記錄於設定檔。

- `direct`：單一關係的稱呼；`labels`：可重用的稱謂運算式。
- `rules`：依順序比對，第一條符合者生效。`patterns` 由 B 走向 A，例如 `parent/sibling/child` 表示父母的手足的子女；`when` 的各條件須同時成立。經同一父母的 `parent/child` 會在判讀時折合為 `sibling`，畫布仍保留實際父母。
- `label` 可為文字，或 `{ "ref": "稱謂鍵" }`、`{ "select": "target.gender", "cases": { "M": "…", "F": "…", "default": "…" } }`、`{ "join": [運算式, "文字"] }`、`{ "field": "target.rankPrefix" }`。程式以固定運算器處理，不執行設定檔內的程式碼。
- 條件欄位有 `target.gender`、`target.orderToBase`、`target.rankPrefix`、`steps.0.gender` 等；`steps` 從 0 起算，指每段路徑抵達的成員。`orderToBase` 與 `orderToPrevious` 分別比較基準成員及上一段成員的手足序，值為 -1（年長）、1（年幼）、0（未知）。這些次序僅適合已知手足，不能用於堂表親跨家庭比較。
- `notes`、`display`、`numerals` 控制補充提示、顯示文字與次序數字；`familyTypes`、`familyKinds` 控制優先搜尋的親屬關係範圍。

支援直系、手足、堂表親、伯叔姑舅姨、姪甥及常見姻親稱呼，另保留契手足、師徒與同門關係。未知性別或長幼會使用合併稱呼並提示；直接記錄的祖孫關係不會憑空補上父母或推定父系／母系。無適用稱謂時，顯示逐段關係。優先搜尋親屬路徑，無親屬路徑才搜尋其他關係；多條等長路徑最多列出 12 條，並保留直接記錄的其他關係供切換。

驗證：`node --test tests/*.test.cjs`；有 Playwright 時可執行 `node tests/browser-kinship.cjs`，以 `PLAYWRIGHT_MODULE` 指定模組位置，`PLAYWRIGHT_CHANNEL` 指定瀏覽器（預設 msedge）。

## 本機開發／測試伺服器

`dev/server.cjs` **不是正式部署架構的一部分**，只作為本機開發與 server regression test harness。GitHub Pages 正式版不需要 Node.js、Server 或 `/api/*`；正式資料永遠先寫入瀏覽器 IndexedDB。

若需要測試 dev adapter，需要 Node.js 20 或更新版本。在此資料夾執行：

```sh
node dev/server.cjs
```

開啟 http://127.0.0.1:4173/family-tree.html 。也可使用 `npm start`（環境有 npm 時）。
伺服器只監聽本機；若連接埠已使用，可設定 `PORT`。要驗證與正式 GitHub Pages 相同的儲存路徑，應優先建置 `dist/` 並以一般靜態 HTTP server 開啟。

## JSON 資料

`fixtures/family.json` 僅是本機 dev adapter／測試用資料；靜態發佈版不會打包它，正式資料使用 IndexedDB 或由使用者匯入的 JSON。每位成員包含自己的關係清單：

```json
{
  "id": "p-example",
  "name": "範例成員",
  "location": "臺中市",
  "position": "教師",
  "notes": "可填寫多行備註說明",
  "gender": "F",
  "siblingOrder": 7,
  "discipleOrder": 2,
  "relationships": [
    { "type": "parent", "personId": "p11", "kind": "親生" },
    { "type": "parent", "personId": "p15", "kind": "親生" },
    { "type": "teacher", "personId": "p24" }
  ]
}
```

根物件為 `{ "schemaVersion": 2, "familyName": "陳氏家族", "people": [...] }`。`familyName` 為可選欄位；舊資料未提供時會使用預設名稱，首次編輯後才寫入。
`location`、`position` 未知時填空字串。`gender` 為 `M`、`F` 或 `U`（未填寫），供兄姊弟妹稱呼使用。
`notes` 為可選的備註說明，最多 5000 字，舊 JSON 不必補填。滑鼠停在人物卡片時顯示原文；關係詳情中亦提供可收折的「備註說明」，保留換行並以純文字呈現。
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
| tangCousin | 堂兄弟姊妹（直接設定） |
| biaoCousin | 表兄弟姊妹（直接設定） |
| fellowDisciple | 師兄弟姊妹 |
| teacher | 師父 |
| student | 徒弟 |

`parent`、`child`、`grandparent`、`grandchild` 另外填 `kind`：親生、過繼、養子女、義子女或契子女。
例如 `{ "type": "grandparent", "personId": "p11", "kind": "契子女" }` 表示 p11 是此人的契祖父母；反向為 `grandchild`。不需要新增中間一代的成員。
直接祖孫關係相差兩代，詳情會在雙方分別列出「祖父母（直接設定）」與「孫子女（直接設定）」，並依性別顯示契祖父、契祖母、契孫子等稱呼。共同祖父母不會自動推導為手足。
例如 `teacher` 表示對方是我的師父，箭頭由對方指向我。
每筆關係只需記在一方，另一方的關係資訊由程式反向讀取，不需要手動重複儲存。
可以先直接記錄堂表親，日後再補父母及上一代的親屬關係。例如在 B 的關係中填 `{ "type": "tangCousin", "personId": "A", "seniority": "older" }`，若 A 男，表示 A 是 B 的堂兄。`seniority` 表示對方較年長（`older`）、較年幼（`younger`），未確認可省略或填 `unknown`；不使用家族手足次序跨家庭推算長幼。表親使用 `biaoCousin`。

之後可新增 C 為 A 的父親、D 為 B 的父親，以及 C／D 的手足關係；原本的直接堂親記錄仍保留。兩人查詢會優先展示 B → D → C → A 的詳細路徑，並可切換回直接記錄。若詳細路徑的堂／表類型相符，會沿用已確認的長幼；若不符，提示確認並保留兩種記錄，不自動刪改資料。只有直接堂表親時不會虛構父母或共同祖先，畫布以獨立的堂親／表親虛線表示。
`fellowDisciple` 以雙端方形虛線顯示。成員尚無已知上代親屬時，可跟隨同門放在同代；只有子女或孫子女不會把本人固定在最上代。移動時會一起調整相連的親屬與師徒分支，維持已有代差。例如 A 是 B 的爸爸、A 與 C 是同門，A 尚無上代親屬而 C 位於第三代時，A 也放在第三代，B 放在第四代。日後補上 A 的父母或祖父母，便優先依明確的親屬關係重新計算。多位同門已有不同代別時，優先依代別較早者安置未定代別成員，不強制同代；顯示調整不寫入 JSON、不用家族手足序推定師門長幼，也不憑空新增共同師父。

新增／編輯成員時填寫 `discipleOrder`（師門次序）：1 至 999 的整數，男女合併排序，數字越小代表師門排行越前；未知可省略或填 `null`。已記錄同門關係或共同師父的成員，依此欄位比較並依性別顯示師兄、師姊、師弟、師妹。任一方未知時不推定長幼，與家族 `siblingOrder` 分開。透過同門關係或共同師父連接的同一師門內，不可重複已知次序；不同師門可以使用相同數字。舊的關係 `seniority` 欄位不再用於判讀，不會自動推算為數字；重新編輯該關係時改用成員的師門次序。
直接填手足關係不會自動假設其父母；要掛在共同父母下，請填入各位父母。
共同父母不會自動視為配偶，婚姻須另外填寫。

## 顯示與新增（本機開發模式）

每次成功載入、儲存成員／關係、修改家族名稱或匯入 JSON 後，會自動備份完整 JSON 到目前瀏覽器，無需先匯出。較小的備份使用有效期一年的 Cookie；超過 3,500 個編碼字元或 Cookie 被停用時，改用 localStorage，避免 Cookie 大小與 HTTP 標頭限制。備份讀取期限同為一年，下方狀態列會顯示實際儲存方式或失敗提示。

重新開啟時優先載入伺服器的最新檔案；若 API 無法載入，會驗證並還原瀏覽器備份，供檢視與匯出，重新連線並重新整理後可繼續編輯。瀏覽器備份不會自動覆寫伺服器資料。備份依瀏覽器、網站來源與連接埠隔離，清除網站資料或私密瀏覽結束可能移除備份。表單尚未按「儲存」的輸入不包含在完整 JSON 備份中。

階層由關係推導，不另存 `gen`：父母在上一層，子女在下一層；配偶、手足與契手足同層。
因此周文彥會與陳建國同層。沒有親屬或手足關係可判定代別的師父，放在徒弟上一代；若需要，相關群組一起往下移以避免第 0 代。此為顯示位置，不會建立父子關係。師父與徒弟兩方已有親屬代別時，以親屬關係為準。
若表單關係造成階層矛盾或循環，伺服器會拒絕儲存並提示修正。

點選「新增成員」填姓名、所在地、職位、性別、手足次序、師門次序與備註說明，再加入任意多筆關係。
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

## 補入親生關係中的成員

若 A 同時與 B、C 為堂親，且 B、C 已記錄為親生手足（或有共同親生父母），相同的「新增 A 父親」提示會共用一個加號位置；兩條堂親關係各自保留。新增一次 A 的父親後，兩條線的該空缺都會更新。

線段文字會依實際字體大小避讓其他標籤、成員卡片與加號，優先保留在原連線附近；視窗縮放及重新繪製時會重新計算。

畫布縮放採用 Semantic Zoom：縮放手勢進行中仍使用 CSS transform 維持流暢，停止後只有跨過 Compact（≤60%）、Condensed（61–85%）、Normal（86–120%）、Detail（>120%）門檻才重新建立卡片與 SVG 路由。Compact 只顯示姓名、Condensed 顯示姓名與所在地，Normal 顯示完整資料；Detail 會重新壓縮 logical card geometry，避免高倍率時只是把卡片無限制放大。關係文字與代數文字會依級距改變 logical font size，連線使用 non-scaling stroke。

加號放在所代表成員的世代：第四代堂表親的父母節點在第三代，祖孫的中間節點在兩者之間的一代。若最早一代仍缺上一代，畫布會一起順延代數，避免出現第零代；提示位置不寫入 JSON。成員清單、搜尋代別與畫布色帶都使用這個順延後的最終顯示代別，因此待補上一代存在時，projection 中原本 `gen = 1` 的成員可能顯示為「第 2 代」，但各介面不會再出現不同代別。

當親生父母以及父母間的手足關係（或共同親生父母）足以證實堂表親路徑時，總覽會自動隱藏重複的直接堂表親連線；原始關係及長幼記錄仍保留，日後路徑不完整時可重新顯示。只有符合堂／表類型的親生路徑才會取代原線。

手足排行第一者即使另一位未填排行，也可判定為長兄／長姊；反向顯示弟／妹。其他排行若不足以判定長幼，會顯示已知排行並保留待確認提示，不猜測未填的數字。

直接記錄的堂表親、親生祖孫，以及尚未記錄共同親生父母的直接手足，會在線上顯示綠色「＋」節點。點擊節點可開啟新增成員表單，先帶入該位置需要的親生子女、父母或手足關係；填寫姓名並確認關係後儲存。

例如 A、B 為堂親時，兩側各有一個父親節點。點 A 側新增 C，表單帶入「A 是 C 的親生子女」；C 放在 A、B 上一代，尚未補齊的堂親線仍以 A、B 為端點。接著點 B 側的節點，新增 D 時帶入「B 是 D 的親生子女」與「C 是 D 的親生手足」。既有堂親與長幼記錄保留，補齊後不再顯示該空缺的加號。C、D 若尚未記錄共同親生父母，還可繼續補入上一代。

連線依卡片的實際位置選擇較短的直角路徑，可從卡片間的空隙穿過，並保留卡片邊緣間距；不再固定繞到畫布外側。代間距與外側留白亦配合縮減。

表親不預設父系或母系；對側有多位已知親生父母時，須在表單選擇新成員要銜接哪位親生手足。已記錄的父母不會以空白節點重複新增。這些節點只是提示，不會儲存為虛構成員；取消表單不修改 JSON。契、義、養、過繼、師徒與同門關係不產生此類節點。

使用 `node tests/browser-intermediates.cjs` 可驗證 API 與靜態版的完整補入流程（需要 Playwright；可用 `PLAYWRIGHT_MODULE` 指定套件位置、`PLAYWRIGHT_CHANNEL` 指定瀏覽器）。

## 主要模組

關係比較若無法整條路徑對應單一稱謂，會先比對其中可辨識的片段，選擇能縮短串接文字的組合。例如「師兄弟的父親的父親的父親的妻子」會顯示「師兄弟的曾祖父的妻子」。片段中的長幼以該片段的起點判斷，父母系別不明、性別未填與非親生關係的提示仍保留；不會因縮寫而刪除畫布上的中間成員，或將祖父的配偶直接當作親生祖母。

`family-model.js` 只負責 domain 資料驗證、關係語意與 domain graph，不再保存畫面代別；`family-display-projection.js` 將 domain graph 投影成含 `gen` 的顯示 graph，並負責師徒／同門等畫面 placement。`family-repository.js` 負責開發 API adapter／靜態 IndexedDB 儲存，`FamilyApp` 保存 application snapshot 與 projected graph，資料更新以 `familyappchange` 通知 UI，不再依賴 `window.FAMILY`。Google Drive 的 transport、同步決策與 OAuth/UI 分別由 `google-drive-client.js`、`family-sync-engine.js`、`google-drive-sync.js` 負責。

族譜畫布使用 GitHub Pages 原生支援的 ES Modules，不需要 bundler。`src/assets/family-tree.js` 是 coordinator；`family-tree-viewport.mjs` 負責縮放、viewport anchor 與 semantic zoom，`family-tree-layout.mjs` 負責 generation blocks 與 connector lane layout，`family-tree-renderer.mjs` 負責 DOM/SVG 基礎 renderer 與圖例，`family-tree-interaction.mjs` 負責 tooltip、pan/pinch、dismiss 與 mobile Back 行為。`relationship-details.js` 負責可收折的關係與備註，`kinship.js` 搭配稱謂 JSON 判讀關係；`dev/build.cjs` 只會複製 `src/assets`、`src/data`，並透過 `dev/site-source.cjs` 展開 HTML partial、注入 Google OAuth Client ID，避免 dev／fixture 誤發布。

### P1 interaction refinements

- Desktop canvas supports cursor-anchored `Ctrl/⌘ + wheel` zoom (including trackpad pinch events exposed as modifier-wheel) while normal wheel/trackpad scrolling remains pan/scroll.
- Semantic zoom state is shown beside the desktop zoom percentage; mobile pinch/fit gestures show a temporary percentage + information-density HUD.
- Portrait mobile header keeps only family filter, member list, add member and More. Import/export, Google Drive, family-name editing, canvas-name visibility, legend and ignored intermediate items are available in the More sheet.
- Google Drive `pending`, `conflict` and `error` states surface an actionable in-canvas attention banner instead of relying only on the small cloud status dot.

### P2 UX refinements

- Mobile新增／編輯成員依「姓名與性別 → 與現有成員的關係 → 選填資料」排列；新成員的所在地、職位、排行與備註預設收合，編輯既有成員時會展開，關係來源／說明／確認狀態另收在每筆關係的進階設定。
- 畫布人物卡不再顯示空白的所在地、職位與手足序；行動版成員清單也隱藏空值欄位，保留姓名、代別與實際有填的辨識資訊。
- 桌面關係圖例預設收合；手機主工具列保留「成員」「新增」「更多」短文字，Google Drive、匯入匯出、家族名稱、姓名顯示與圖例等低頻操作集中在 More。手機成員詳情則直接顯示「編輯」「新增親屬」，將「查關係」「定位」收進詳情內的「更多」。
- 兩人關係選單顯示「姓名 · 第 N 代」，選定後直接呈現完整問句，例如「陳文彬 · 第 3 代 是陳阿土 · 第 2 代的誰？」；完整路徑說明亦改用「查詢成員／稱呼基準」，不再要求使用者對照 A／B。
