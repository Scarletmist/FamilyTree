## 1. 建立文件骨架

- [x] 1.1 交付 Homepage entry document：在專案根目錄建立 `index.html`，含 `<!doctype html>`、`<html lang="zh-Hant">`、`<meta charset="utf-8">`、`<meta name="viewport" content="width=device-width, initial-scale=1">`、`<title>陳氏家族</title>`，以及五個依序排列的空白區塊容器（hero、簡介、數據列、入口卡、頁尾）。驗證：以瀏覽器用 `file://` 開啟 `index.html`，頁面載入無錯誤，開發者工具的 Console 無訊息、Network 面板無任何對外部主機的請求。
- [x] 1.2 交付 Homepage entry document 的樣式承載方式：在 `<head>` 內加入單一 `<style>` 區塊，定義色彩、字級、間距的 CSS 變數與 `box-sizing` 基礎重置，全站樣式皆寫在此區塊。驗證：全文檢視 `index.html`，確認不存在 `<link rel="stylesheet">`、不存在 `<script src>`、不存在任何 CDN 或 web font 網址。

## 2. 填入頁面內容

- [x] 2.1 交付 Hero section：頁面首個區塊顯示家族名稱「陳氏家族」、一句話網站簡介，以及文字為「瀏覽族譜」的主要 CTA 按鈕。驗證：在 1280x800 視窗開啟頁面，三項內容皆在未捲動的情況下可見。
- [x] 2.2 交付 Family introduction section：於 hero 之後加入家族簡介區塊，內含 2 至 3 個 `<p>` 段落，描述家族起源與本站用途。驗證：目視確認段落數量落在 2 至 3 之間且文字非佔位符。
- [x] 2.3 交付 Family statistics row：以三欄呈現「世代 5」「成員 128」「最早紀錄 1890」，數值與標籤直接寫在 HTML 標記中。驗證：目視確認恰為三組數值且各自附有標籤；檢視原始碼確認數值為字面值，未透過 fetch、JSON 或任何資料來源取得。
- [x] 2.4 交付 Sub-page entry cards：加入恰好三張卡片，標題分別為「族譜圖」「成員列表」「家族相簿」，每張附一句說明文字，且三張卡片與 2.1 的「瀏覽族譜」CTA 的 `href` 皆為 `#`。驗證：依序點擊四個連結，瀏覽器均停留在首頁，未出現 404 或導向不存在的文件。
- [x] 2.5 交付 Footer：頁面最末加入頁尾，顯示聯絡方式與 `YYYY-MM-DD` 格式的最後更新日期。驗證：捲動至頁面底部，目視確認兩項資訊皆存在且日期符合該格式。

## 3. 版面與驗收

- [x] 3.1 交付 Responsive layout：加入 `max-width: 768px` 的 media query，使數據列與入口卡在窄視窗改為垂直堆疊。驗證：於瀏覽器將視窗寬度設為 375px，確認三組數據垂直排列、三張卡片垂直排列，且 `document.body.scrollWidth` 不大於 `window.innerWidth`（無水平捲動）；再設為 1280px，確認兩者恢復水平並排。
- [x] 3.2 逐條核對 `openspec/changes/add-family-homepage/specs/family-homepage/spec.md` 的全部七項 requirement 情境，確認實作與規格一致。驗證：每個 `#### Scenario` 的 WHEN/THEN 在瀏覽器中手動走過一次並成立。
