# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.過長時抽出舊者為`experience_<年月日>.md`,並於本檔註明何時抽出.

## 2026-11-03 bf297:逾時、重試與下單狀態未知之修正

- **`retries` 是總送出次數**:`@binance/common` 之 `retries:N` 不是重試次數,`retries:1` 只送 1 次且失敗拋無類別 `Error`;要拿到有類別之 `NetworkError` 只能 `retries:0`.
- **`timeout` 是閒置型**:回應滴入可超過,不是總時長.
- **SDK 之 `axios.defaults.baseURL` 優先於 basePath**:測試若靠它導向假伺服器,測不到端點選擇,故改以 `basePath` 指向本機;`validateTLSUrl` 於 2.4.5 未被呼叫,http 可用,升版若啟用要改走本機 https.
- **假伺服器之斷線用 `req.socket.destroy()`**:立即得 `NetworkError`,比真實逾時(每次 3 秒)快;真實逾時只留代表性案例(T01、T02、T05、T06).修前對照時 reset 不足以重現 -1021(年齡不到 5 秒),改斷言「時間戳每次不同」即可分辨.
- **約 8 秒之回查案併到 `before` 並行**:情境以 API key 隔離,同檔 17 案約 10 秒跑完;Mocha 不用 `--parallel`.
- **eslint `--fix` 會移除 BOM**:根目錄 `g_*.mjs` 有 BOM,`--fix` 不只動格式;只跑 `src test`,範例檔改完不要 `--fix`.
- **`-2013` 不等於不存在**:algo 剛下單後 queryAlgoOrder 可 -2013 達 1.3 秒;撤單後可 NEW 約 0.5 秒;`openAlgoOrders` 首查即反映.故先查 open,單筆查詢要輪詢.
- **不重送進場單之防線有三層**:同程序在途 Set、送單前閘、呼叫端落盤;前兩層都擋不了跨程序同時重呼叫,不要宣稱已消除.
- **錯誤分類之 `source` 預設不得是 network**:只有 `source:network` 能走到「未執行」之定論,未知類別誤標 network 會把已執行當未執行.
- **只在特定站點成立之碼(-2011、-4046、-4059)不得在分類函數裡給 notExecuted**:外審抓到進場站收到 -2011 被判確定未執行;語意交站點依 kind 處置,分類本身一律未知.
- **同 ID 查單回最新一筆,其終局不代表本次**:補掛前舊單 CANCELED、本次在途時會誤判 notPlaced;以 `createTime` 與本次送出時刻比對,無時間欄就不下結論.
- **`execState` 要回答呼叫端下一步**:`TDID_USED` 回 notExecuted 看似正確(本次沒送),呼叫端卻會換新 ID 重下而加倍;改 unknown 並另帶 `sentThisCall:false`.現貨 OCO 被拒同理,整筆是 executed,OCO 另列.
- **浮點截位會少保護**:`Math.floor(0.29*100)` 得 28;成交量一律以十進位字串截位.
- **測試舊單與成功路徑混用**:補掛前置查詢會先吃掉注入序列之第一項,以 filter 限定該腳並先放行前置,不要靠順序碰巧.
- **外審有效**:程式與測試全綠(含變異前)時,兩位外審仍找出 8 條以上高嚴重度屬實缺陷;金額相關之封裝不要以全綠當完成.
- **SDK 跨主版號升級先看執行碼差異,不看型別檔**(2026-11-09 spot 32→34、derivatives 37→39、common 2.4.5→2.5.2):`npm pack` 舊版解到空夾(Windows 路徑含 `C:`,`tar` 須加 `--force-local`)後 `diff` 新舊 `dist/index.mjs`——spot 只剩版本號、文件與列舉常數,derivatives 只有 `getIncomeHistory` 之 `page`、`allOrders` 不再斷言 `symbol`、`modifyOrder` 增 `reduceOnly`,common 只有 `NetworkError` 多帶 `transportCode`.列舉皆純常數、無執行期驗證,`CANCEL_ONLY` 不會令 SDK 拋錯,風險只在本套件自己之判定;`symbolStatus` 是 spot 市場資料之請求參數、`executionReport.N` 是 WebSocket 事件,本套件皆未用;棄用者是 `orderOco()`(REST)與 `orderListPlace()`(WebSocket),本套件用之 `orderListOco`、`orderListOtoco` 非棄用.`allOrders` 之 `symbol` 不再由 SDK 把關,空 symbol 之唯一防線是 `getBinaClient` 入口.common 2.5.2 起 `retries>0` 耗盡改拋 `NetworkError`(2.4.5 為無類別 `Error`),本套件 `retries:0` 不受影響;`validateTLSUrl` 仍未被 REST 路徑呼叫.
- **測試鎖有獨佔者排隊時等待很長**:本輪單次等 40 分;把「全套、修前對照、差異、變異」合成一支腳本一次排隊,比分次排省時間,腳本於取得鎖時才讀當時之程式與測試.

## 2026-11-18 Gitea #177:以單位數定量(`opBinaContractMarketUnits`)

- **打包檔之 external 與動態 `import()`**(rollup 4.67.5、w-package-tools 1.1.28 之 `rollupFiles`,UMD):`external` 以字串全名比對,深層子路徑須逐字列出;列入後 UMD 產物保留惰性之 `import("w-trade-backtest/src/…")`(不進 factory 參數、不內聯),`require` 載入打包檔後於 Node 24 以原生 `import()` 自打包檔所在處往上解析 `node_modules`.只列 `calcBaseUnitQuantity.mjs` 不夠:`buildBaseUnitNotional.mjs` 以相對路徑匯入它,未列者連同其相依被內聯,成「判定為快照、計算為已安裝檔」.
- **打包之驗證作法**:`gDistRollup.mjs` 之複本只改 `fdTar` 為 `./tmp/…`;擺放 `./tmp/<夾>/<名>/node_modules/{w-exchange-binance/dist/<打包檔>, w-trade-backtest/{package.json, src/…}}`,ESM 解析找到最近之 `w-trade-backtest` 即停,只放 `package.json` 即模擬「不含該檔之版本」(不必動已安裝之套件);包裝檔內記 `import.meta.url` 並改其結果(如單位數加倍),新入口之送出數量隨之即證取用已安裝之檔.2026-11-18 四擺放(包裝、缺檔、無預設匯出、缺 build)皆合:舊入口各 0.007 照常,新入口依序為 0.016(加倍)、三者於任何請求前拋 unavailable.
- **`buildBaseUnitNotional` 之可計算性為「以價格 1 試算」**:與提出端之「名義門檻恰由最小數量滿足之價格」不同;價格 1 不可計算者(步長極小)於實際價格或可計算,仍拒(與回測套件一致).其訊息以單一名稱涵蓋 `rule` 與 `buffer`(`invalid <name>.rule.<欄>`、`invalid <name>.buffer`、`invalid <name>: step count k …`),故由 st 轉成之規則與商品資訊之規則之欄位訊息無法由它給出,欄位檢測留在 `getContractRule`、`getContractRuleFromSymbol`.
- **能使「最小合法數量之試算失敗而價格 1 之判定照過」之規則**:須價格 1 之格數在安全整數內、而名義門檻不起作用之價格(`2 × minNotional × (1 + buffer) ÷ stepSize`)下名義溢位,例 `{ stepSize: 2e284, minQty: 2e299, minNotional: 1e300 }`(緩衝 0);提出端之例 `{ stepSize: 1e-15, minQty: 1, minNotional: 1e300 }` 於價格 1 即被判不可計算,已不能鑑別該分支.
- **`git archive HEAD` 解出之檔為 LF,工作樹為 CRLF**(`core.autocrlf=true`):以 `diff -rq` 比對全部不同,須 `--strip-trailing-cr`.README 為 CRLF,以腳本插入區塊時轉 CRLF,Edit 工具之新行為 LF.
