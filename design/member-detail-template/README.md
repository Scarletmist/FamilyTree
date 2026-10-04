# 成員詳細資料 Layout Template

啟動：`node design/member-detail-template/serve.cjs`，開啟 <http://127.0.0.1:4199/>。

預覽外框提供 390×844 直式、844×390 橫式與 320×740 小尺寸，並能切換瀏覽、完整閱讀、收合摘要。也可直接開啟 `/workspace.html`，隨實際裝置尺寸調整。

介面沿用目前 src 的實際 runtime；覆寫僅載入 template。伺服器建立 fixture 的暫存副本，陳文彬的示例所在地／職位只加入副本。未修改正式 src、fixture 或 Google Drive。預覽中的編輯只儲存到副本。

設計：直式瀏覽面板高 63dvh，閱讀接近全高。橫式側欄接近全高、寬 360–440px，可切到完整閱讀。固定精簡導覽；姓名摘要、操作列、所在地與關係共用單一捲動區。新增親屬與定位留在更多選單。保留原有關係導覽、查詢與所在地事件。

直式把手跟隨拖曳，以釋放速度與位置決定停留狀態；有展開按鈕替代手勢。完整閱讀使用背景遮罩與焦點限制。減少動態設定直接切換尺寸。

驗證：390×844 的內容可視高度約 465px（瀏覽）／761px（閱讀），原版約 159px；844×390 約 315px，原版約 83px。320×740 瀏覽約 399px，面板沒有水平溢出。已操作上拉展開、三種模式切換、親屬返回與更多選單；新增親屬保留 person-plus。旋轉重建時依成員保存內容捲動位置，橫式瀏覽在版面安定後重新定位選取成員。

畫面：`portrait-browse.png`、`portrait-read.png`、`landscape-browse.png`、`landscape-read.png`、`landscape-read-scrolled.png`。
