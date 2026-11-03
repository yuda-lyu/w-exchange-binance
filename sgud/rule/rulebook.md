# 規則帳本

本檔為套件設計與開發階段之規則帳本(藍圖),為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.當前已做到哪些記於`sgud/state/state.md`.過長時依類型拆為`rulebook_<類型>.md`,本檔只留索引.

盤點指令一律於套件根以 Grep 工具或 `git grep` 執行;站點表之判準分「已套／未套／刻意不套」.

## R-CLIENT 統一 client

**規則**:全部幣安請求之 client 只由 `src/getBinaClient.mjs` 之 `getBinaClient`(合約)、`getBinaSpotClient`(現貨)建立;固定 `timeout: BINA_TIMEOUT_MS(3000,暫定,單一常數)`、`retries: 0`、`backoff: 0`;每個簽章請求顯式傳 `recvWindow`(`BINA_RECV_WINDOW_MS` 5000).

**理由**:SDK 預設 1 秒逾時,GET/DELETE 沿用舊時間戳重送(得 -1021);`retries:N` 是總次數且耗盡時拋無類別 `Error`.重試交本套件,每次重新呼叫即重新簽章.另固定 `httpsAgent: new https.Agent({ keepAlive: false })`:SDK 預設每請求新建 keep-alive Agent 且不銷毀,閒置連線累積;共用連線又會多出「閒置被對方關閉」之未知結果,故維持每請求新連線、回應後即關.

**盤點指令**:

```
git grep -n "new DerivativesTradingUsdsFutures\|new Spot(" -- src        # 應只在 src/getBinaClient.mjs,各 1 處
git grep -n "client\.restAPI\." -- src                                   # 站點全集
git grep -n "console\.log(" -- src | git grep -v "//"                    # 應無未註解者(診斷 D2)
```

**站點全集**(對外 18 支;請求站點見下):

| 操作 | 站點 | recvWindow | 已套 |
|---|---|---|---|
| Market | queryOrder(閘)、changeInitialLeverage、changeMarginType、changePositionMode、markPrice(不簽章,刻意不帶)、positionInformationV3、newOrder | 帶 | 已套 |
| placeBinaProtect(Market、PlaceProtection 共用) | newAlgoOrder、currentAllAlgoOpenOrders、queryAlgoOrder、queryOrder、positionInformationV3 | 帶 | 已套 |
| reconcileBinaOrder(Market、MarketEntry 共用) | queryOrder、positionInformationV3 | 帶 | 已套 |
| MarketEntry | queryOrder(呼叫端給 ID 才過閘)、positionInformationV3、newOrder | 帶 | 已套 |
| QuerySymbol | exchangeInformation(不簽章,刻意不帶) | — | 已套 |
| QueryAccount | accountInformationV3 | 帶 | 已套 |
| QueryPosition | positionInformationV3 | 帶 | 已套 |
| QueryOrderInfo、QueryOrderByClientId(`readBinaLeg`) | queryOrder、currentAllAlgoOpenOrders、queryAlgoOrder | 帶 | 已套 |
| ListOrders | currentAllOpenOrders、currentAllAlgoOpenOrders | 帶 | 已套 |
| History | allOrders、queryAllAlgoOrders | 帶 | 已套 |
| Trades | accountTradeList | 帶 | 已套 |
| CancelOrder、CancelAlgo(`cancelBinaSingle`) | cancelOrder/cancelAlgoOrder、currentAllOpenOrders/currentAllAlgoOpenOrders、queryOrder/queryAlgoOrder | 帶 | 已套 |
| CancelAll、CancelAllAlgo(`cancelBinaAll`) | cancelAllOpenOrders/cancelAllAlgoOpenOrders、開啟清單 | 帶 | 已套 |
| Residual | 轉呼叫上列,opt 全部下傳 | 帶 | 已套 |
| SpotMarket | newOrder、orderListOco | 帶 | 已套 |
| SpotLimit | orderListOtoco | 帶 | 已套 |

**測試**:`test/api-binaFakeClient.test.mjs`(recvWindow)、`test/api-binaFakeRead.test.mjs`(T01～T04)、T39 變異 M39.

## R-FAILCLOSED 入口 fail-closed

**規則**:任何請求之前擋下:`basePath` 空或非網址、金鑰空、用到 symbol 者 symbol 空;`forTest` 為 true 而 basePath 之主機為正式端點(主機小寫並去尾隨點,以 SDK 匯出常數比對,另含 `fapi\d*.binance.com`、`api\d*.binance.com`);`axios.defaults.baseURL` 非空(全域設定會蓋過 basePath,`@binance/common/dist/index.mjs:301`).`forTest` 判定順序 `opt.forceTest` > `st.forTestAll` > `st.binance.forTest`,皆非布林預設 true.

**盤點指令**:`git grep -n "getBinaClient\|getBinaSpotClient" -- src`(每支對外操作恰 1 處,Residual 另由子操作檢查).

**站點全集**:全部 18 支對外操作;`useSymbol:false` 者為 MarketEntry、QuerySymbol、QueryAccount(以參數或無需 symbol),QueryOrderByClientId 於給 `opt.symbol` 時.

**測試**:`test/api-binaFakeClient.test.mjs` T64(全部操作參數化,請求 0 次)、T42.

## R-ERRCLASS 錯誤分類(預設未知,確定被拒採白名單)

**規則**:`src/classifyBinaErr.mjs` 為單一來源.`execState`:`notExecuted`、`unknown`;組合操作另有 `executed`(進場或買入已成交);`TDID_USED`、`ID_USED`、`TDID_IN_FLIGHT` 為 `unknown` 並帶 `state.sentThisCall:false`(本次未送單,前次可能已成交,不得回 notExecuted 誘使換新 ID 重下).對外錯誤一律 `BinaOpError`,帶 `execState`、`binance{kind,code,httpStatus,sdkErrorName,source,attempts,msg}`,原錯在 `cause`.呼叫端不比對訊息.

| 來源 | 寫入語意 | 讀取可重試 |
|---|---|---|
| `RequiredError`(未送出) | notExecuted | 否 |
| `NetworkError` | unknown(source:network) | 是 |
| `ServerError`(任何 5xx) | unknown(source:server) | 是 |
| `ConnectorClientError`(含 408,不論有無碼) | unknown(source:server) | 是 |
| `-1006 -1007 -1000 -1001 -1008` | unknown(source:server) | 是 |
| 本體無法解析或不符成功形狀(`BinaBodyError`) | unknown(source:server) | 是 |
| 4xx 無數字碼 | unknown(source:server);429、418 之 kind 為 rateLimited | 否 |
| 白名單 `-1021 -5028 -1022 -1102 -1111 -1121 -2015 -2018 -2019 -2021 -2022 -2024 -2025 -4005 -4015 -4045 -4061 -4164 -1003 -1015` | notExecuted(`-1003 -1015` 或 429、418 之 kind 為 rateLimited) | 否 |
| `-2011` | unknown,kind notOpen:語意只在取消站成立(單已不在開啟中,查清終局);他站收到走未知 | 否 |
| `-2013` | unknown,kind notObserved:本次未觀察到,**不是未執行之定論** | 否 |
| `-4116` | unknown,kind duplicate | 否 |
| `-4046 -4059` | unknown,kind noChange:語意只在帳戶設定站成立(無須變更,不比對字串);他站收到走未知 | 否 |
| 其他帶碼 4xx | unknown(kind unlistedCode;429、418 之 kind 為 rateLimited) | 否 |
| 非 SDK 已知類別 | unknown(kind unexpected,source:server;source 不得為 network,否則可能被判未執行) | 否 |

**先未知後確定不可覆蓋**:同一操作內任一次得 unknown,其後白名單碼仍為 unknown(`toBinaOpError` 之 `sawUnknown`).

**盤點指令**:`git grep -n "classifyBinaErr\|toBinaOpError\|sendBina" -- src`;`git grep -n "err\.message\|includes(" -- src`(應無以訊息判定者).

**測試**:`test/unit-classifyBinaErr.test.mjs`、`test/api-binaFakeMatrix.test.mjs`(站點×結果矩陣之不變式).

## R-READ 讀取重試

**規則**:讀取類一律 `callBinaRead`(3 次,間隔 200、400ms,每次重新呼叫);只重試上表「可重試」;失敗拋 `BinaOpError`,`binance.attempts`.回查內之查詢單次送出(`sendBina`),不套重試,以免拖長無保護時間.

**盤點指令**:`git grep -n "callBinaRead(" -- src`;`git grep -n "sendBina(" -- src`.

**站點判準**:對外查詢與列舉、閘、部位快照走 `callBinaRead`(已套);`reconcileBinaOrder`、`placeBinaProtect`、`cancelBinaSingle` 內之查詢刻意單次送出.

**測試**:`test/api-binaFakeRead.test.mjs` T01～T04、T43(假時鐘驗間隔).

## R-RECONCILE 回查狀態機

**規則**:`src/reconcileBinaOrder.mjs`.未知時先查再回報,只查不送.`seen`、`maxExecutedQty` 單調:查得量倒退回 `partial`(`executedQtyBackward`),不得判 0 成交;查單回應缺成交量視為查詢失敗;查得與本次不符(time 早於 tSign-2s、side、origQty 不同)維持 unknown(`identityMismatch`,已知有量者 `partial`);429/418 停止輪詢;到期:有成交量 `partial`,曾見存在 `unknown`,否則交 `judgeNotExecuted`.部位回應每列須有方向與有效數量(`shapePositions`),缺欄不得當 0.

**`judgeNotExecuted` 為 §9 二之單一分支**:須同時滿足窗後查無(送出時刻 ≥ tSign+recvWindow+1000)、`source==='network'`、部位讀得到且未變,才判 `notExecuted`(`confirmedBy:notFoundAfterWindow+positionUnchanged`).使用者若裁示乙(一律未知),只改此函數開頭.

**盤點指令**:`git grep -n "reconcileBinaOrder(\|judgeNotExecuted" -- src`(呼叫站:Market、MarketEntry).

**已知限制**:過窗查無非數學保證:已到閘道之單若排隊超過窗且當下部位未變會判錯(方案最弱假設).

**測試**:`test/api-binaFakeReconcile.test.mjs`(T08、T12、T47～T55,真實視窗約 8 秒,集中於本檔且並行);`test/api-binaFakeMarketEntry.test.mjs`.

## R-NORESEND 不重送進場單

**規則**:進場單(Market 之 newOrder、MarketEntry、現貨 BUY、OCO、OTOCO)每次呼叫至多送 1 次:市價單已成交後同 ID 重送會被接受而部位加倍(`live1:50-53`).同 ID 防線:同程序在途 Map(`src/binaInFlight.mjs`,Market 與呼叫端給 ID 之 MarketEntry 共用,鍵為端點與實際進場 ID;狀態未知、部分成交不釋放)、送單前閘(查得任何狀態 `TDID_USED`/`ID_USED`,查詢失敗 `NOT_ENTERED{precheck}`/`NOT_EXECUTED{precheck}`).MarketEntry 之 `opt.clientOrderId` 給了而格式無效即拋(K3 之例外:靜默換 ID 使去重失效).跨程序去重本套件做不到,為呼叫端義務.

**盤點指令**:`git grep -n "restAPI\.newOrder\|orderListOco\|orderListOtoco" -- src`(皆不在迴圈內;站點:Market、MarketEntry、SpotMarket、SpotLimit).

**測試**:T07、T12、T22、T24、T25、T61、矩陣不變式②;變異 M19～M24.

## R-PROTECT 保護單同 ID 重送之前提

**規則**:`src/placeBinaProtect.mjs`.同 `clientAlgoId` 重送只在開啟中冪等;觸發成交後 ID 不佔位,重送會再建一張,孤單觸發即反向(測試端點).故未知後**依序排除已觸發才可重送**:①`openAlgoOrders` 有且相符 → placed;不符 → conflict;查詢失敗 → unknown(排除不了);②`queryAlgoOrder` 輪詢至多 2 秒:`TRIGGERING/TRIGGERED/FINISHED` → triggered,`CANCELED/EXPIRED/REJECTED` → notPlaced,`NEW` 而 open 無或其他值 → unknown;③`queryOrder(clientAlgoId)` 查得 → triggered,查詢失敗 → unknown;④部位以平倉方向帶號後小於 `minPos`(Market 為進場前部位＋成交量,PlaceProtection 為入口部位)或讀不到 → unknown;⑤才同 ID 重送.②③查得之單早於本次送出 2 秒以上者為前次舊單,視同未觀察到;無時間欄 → unknown.PlaceProtection 另於首送前排除同 ID 已觸發(`precheck`).成功回應須 `algoStatus:NEW` 且方向、類型、量、價相符,否則當 unknown.最多 3 送,間隔 600ms,單腳預算 20 秒;429/-1015 等 1000、2000ms;418 不再送;未知後白名單拒絕須 open 確認才 placed,否則 unknown.

止損 triggered 即不掛止盈.兩腳對應 outcome 為 `getProtectOutcome` 單一來源.**不自動平倉**(§9 一 A).

**盤點指令**:`git grep -n "placeBinaProtect(\|getProtectOutcome" -- src`(站點:Market、PlaceProtection).

**測試**:T16～T21、T46、T56～T60;變異 M25～M33.

## R-CANCEL 取消語意

**規則**:`src/cancelBinaSingle.mjs`.目標是這張單不再開啟;已不開啟不是錯誤但告知終局.-2011 → 查單(輪詢至多 2 秒)回終局;unknown → 查開啟清單:仍開啟以**交易所 ID** 重送(最多 3 送;client ID 可重用,用它重送可能撤到同 ID 新單;以 client ID 取消者,清單所見須早於本次取消,否則拋 unknown 不撤),不開啟查單回終局;定論不了拋 unknown.DELETE 回 200 須 `status:CANCELED` 且為目標單,否則當未知.`alreadyClosed` 只在查得終局為 true,`NOT_FOUND` 不設且 `positionChanged` 為 null.全撤:未知後查清單,空即成功帶 `inFlightUntil`,不空不重送(可能是並行流程剛掛之止損);限流不查不重送.ID 一律視為字串,不經數值轉換,BigInt 與非安全整數無效(K6).

**刻意擴充**:`TRIGGERING`、`TRIGGERED` 回傳時 `positionChanged:true`(§5.6 只列 FILLED、FINISHED、CANCELED 帶量;正在變動不得回 false);`PARTIALLY_FILLED`、`NEW` 仍在開啟中或落後,走拋錯.

**盤點指令**:`git grep -n "cancelBinaSingle(\|cancelBinaAll(\|parseCancelTarget" -- src`.

**測試**:`test/api-binaFakeCancel.test.mjs` T06、T26～T31、T69;變異 M53～M58.

## R-RESIDUAL 殘單判定

**規則**:`opBinaContractCancelResidualOrders` 依部位符號、腿量、腿齡與對腳判定,判不了不撤且回報;先列單後查部位;依字尾解析 `_SL`、`_TP`;opt 全部下傳.

| 條件(依序) | 處置 |
|---|---|
| 查部位失敗 | 整批不撤,拋 unknown(`POSITION_UNREAD`) |
| 任一腿齡 <10 秒或無時間欄 | `skipped:tooNew` |
| 部位連讀兩次(間隔 1 秒)皆 0 | 全撤(含兩腳俱在) |
| 兩次讀不同 | `skipped:positionChanging` |
| 部位反向(LONG 負、SHORT 正) | `skipped:reversedPosition` |
| 超過 2 筆、兩筆非一 SL 一 TP、同組 positionSide 不一、腿之方向或類型與字尾不符、腿量非正 | `skipped:anomalous` |
| 該 kind 腿量合計(同 positionSide 跨 tdid)大於 abs(部位) | `skipped:oversized` |
| 2 筆一 SL 一 TP | 不動 |
| 1 筆,對腳 FINISHED(普通單 FILLED)且量足 | 撤 |
| 1 筆,對腳量不足、查無、查詢失敗 | `skipped:partnerUnconfirmed` |
| 1 筆,對腳其他狀態 | `skipped:partnerStatus:<值>` |
| 撤單後部位不為 0、0 筆腿 | `unprotected` |
| 撤單後有腿而某 kind 合計少於部位 | `underProtected` |
| 撤單結果非 CANCELED(FILLED、FINISHED、NOT_FOUND 等) | `closedOtherwise`,不算撤到;失敗入 `failed`,不拋 |

**已知限制**:兩輪之間部位已歸 0 而留著之單仍可能觸發並反向;先列單後查部位非原子快照.呼叫端須定期呼叫.

**盤點指令**:`git grep -n "skipGroup\|residualDecision" -- src`.

**測試**:`test/api-binaFakeResidual.test.mjs` T32～T37、T44、T45、T65、T66;變異 M41～M52.

## R-INPUT 入口檢查與訊息

**規則**:依 `dspec/輸入參數之檢測機制.md`:檢測先於副作用(V17);訊息 `invalid <名稱>: must be <種類>`,不回顯值(V19、V20);必須參數無效即拋(K2);opt 非預期視為未給(K3,**刻意例外** `opBinaContractMarketEntry` 之 `opt.clientOrderId`:此鍵用於去重,靜默換 ID 使去重失效,無效即拋);ID 視為字串(K6).`tdid` 合約 `^[.A-Z:/a-z0-9-]{1,30}$`,現貨 `^[A-Za-z0-9-]{1,30}$`,不含 `_`.

**盤點指令**:`git grep -n "throw new Error" -- src` 逐筆看訊息無 `${輸入}`.

**刻意不套**:`opt.debug`(規格 K3 之 `debug` 由 §7 opt 解析函數統一實作,該函數未定案,規格為草案).

## R-TRACE 觀察回調

**規則**:計時器相關函數依 `dspec/計時器相關函數之觀察回調與測試.md` 提供 `opt.onTrace`,一律 `wsemi/src/getTrace.mjs`.事件:`attempt`、`retry`、`giveUp`、`reconcileQuery`、`reconcileDone`、`protectSend`、`protectDone`、`cancelSend`、`cancelDone`、`residualDecision`;欄位只放原始值.

**盤點指令**:`git grep -n "getTrace(" -- src`.

**站點**:`callBinaRead`、`reconcileBinaOrder`、`placeBinaProtect`、`cancelBinaSingle`、`cancelBinaAll`、Residual(已套).

**測試**:T43(假時鐘驗間隔;五種回調案:未傳、紀錄器、拋錯、回傳 rejection、非函數).

## R-TEST 測試分層

| 層 | 檔 | 範圍 | 連外 |
|---|---|---|---|
| 單元 | `test/unit-classifyBinaErr.test.mjs`、`test/unit-calcContractQuantity.test.mjs` | 分類表、下單量 | 否 |
| 假伺服器 | `test/api-binaFake*.test.mjs`、`test/tools/binaFakeServer.mjs`(固定埠 8297) | 全部錯誤語意,決定性 | 否(`test/tools/binaNetGuard.mjs` 於網路層攔非 loopback) |
| 測試端點 | `test/api-binaDemo*.test.mjs` | 真實端點之成功路徑與契約 | 是;**預設略過,`BINA_LIVE_TEST=1` 才跑**;主機白名單、記憶體內抹除正式金鑰、測前測後確認帳戶已清回 |

`package.json` 之 test 字串不變.假伺服器以 `basePath` 導向,不用 `axios.defaults.baseURL`(方案要擋它).SDK 2.4.5 之 `validateTLSUrl` 未被呼叫,http 可用;升版若啟用,改走本機 https.

**改動範圍 → 測試檔**:本套件無瀏覽器 e2e;`src/` 任何改動跑全部離線測試.

## 破壞性變更紀錄

見 README〈Breaking changes〉與〈呼叫端義務〉(2026-11-03 bf297).
