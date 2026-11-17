# 瀏覽器支援與驗收

## 支援目標

本專案的最低支援目標訂為 Chrome／Edge 134、Firefox 136、Safari／iOS Safari 18.3；Android 使用符合相同 Chrome 下限的版本。需要 HTTPS 或 localhost、安全來源下的 IndexedDB，以及 JavaScript。Node >=20 是開發／測試環境需求，與瀏覽器版本分開管理。

這是工程支援政策，不代表已在每個最低版本的真實裝置完成驗收。自動化驗證使用鎖定的 Playwright 所附 Chromium、Firefox、WebKit；本機也可使用 Edge。WebKit 模擬不等同於實體 iPhone 的 Safari。

新增 Web API 前，依 Modern Web Guidance 指南核對上述目標；不在範圍內的功能須偵測支援並提供相同核心操作或合理退路。可選效果不能阻擋新增、編輯、查詢、匯入、匯出及本機儲存。

目前使用原生 dialog、Popover、不可變陣列方法及 IndexedDB。畫布動態效果尊重 reduced-motion；CSS 效果使用現有退路；Web Locks 不可用時停止自動定位而保留編輯及地圖查看。維持 Chrome、Firefox、Safari 可用的標準方案，不自動開啟 Origin Trials 或 volatile API。

## 開發依賴與指令

Playwright 固定為 1.62.1，並以 package-lock.json 鎖定。一般網站執行仍不需要 Node 或 npm 套件。

```sh
npm ci --ignore-scripts
npx playwright install chromium firefox webkit
npm run validate:unit
npm run test:smoke:browser
npm run test:performance
```

`PLAYWRIGHT_ENGINE=chromium|firefox|webkit` 選引擎。Windows 未設定 channel 時沿用 Edge；`PLAYWRIGHT_CHANNEL=bundled` 明確使用 Playwright 瀏覽器。`PLAYWRIGHT_MODULE` 可指向既有安裝；`PLAYWRIGHT_EXECUTABLE` 可指定實際執行檔。PowerShell 用 `$env:PLAYWRIGHT_ENGINE='firefox'` 設定後執行相同指令。

Linux CI 依官方方式執行 `npx playwright install --with-deps <engine>` 安裝瀏覽器與必要系統依賴。[Playwright CI 文件](https://playwright.dev/docs/ci) 說明安裝流程；套件與瀏覽器版本需配套，見 [Browsers](https://playwright.dev/docs/browsers)。

## 必要關卡

PR 與 main／master push 的 Validate FamilyTree 工作流程執行 Node 20、22 的單元測試、建置及發布包檢查；Chromium、Firefox、WebKit 分別執行 P1 的 15 組情境與既有 API／靜態介面流程。Chromium 另量測命令管線的圖譜建置次數。Pages 發布先等待同一個可重用工作流程成功，再建置含正式 OAuth client id 的發布包。

任一測試程序非零退出、沒有可解析測試數、零情境或超過建置次數上限，都會失敗。不以重試掩蓋失敗；本機可限定問題情境重現，保留原始結果。

## 仍需真機與輔助技術驗收

- iOS／Android 的鍵盤、網址列、安全區、縮放與觸控手勢。
- Safari 最低版本及 Android 實機上的儲存／還原。
- VoiceOver、NVDA／Firefox、Narrator／Edge 的欄位值、錯誤播報及背景更新焦點。
- 200% 字體／頁面縮放、強制色彩、減少動態效果。
- 真實 Google OAuth／Drive 授權、離線與多裝置衝突；自動化只使用模擬與合成資料。

測試結果應記錄瀏覽器版本與日期，不能把「宣告支援」或「CI 已設定」寫成已通過的實機結果。
