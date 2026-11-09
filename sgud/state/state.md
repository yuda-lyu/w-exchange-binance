# 狀態

本檔記當前已開發功能之最新狀態,為現況;藍圖見 `sgud/rule/rulebook.md`.只記現況,過程寫入 `sgud/exp/experience.md`.

## 功能現況

| 功能 | 狀態 | 帳本 | 測試 |
|---|---|---|---|
| 統一 client、fail-closed | 已做 | R-CLIENT、R-FAILCLOSED | `test/api-binaFakeClient.test.mjs` |
| 錯誤分類 | 已做 | R-ERRCLASS | `test/unit-classifyBinaErr.test.mjs`、`test/api-binaFakeMatrix.test.mjs` |
| 讀取重試 | 已做 | R-READ | `test/api-binaFakeRead.test.mjs` |
| 回查狀態機 | 已做;`judgeNotExecuted` 暫依 §9 二之甲,**使用者尚在裁示** | R-RECONCILE | `test/api-binaFakeReconcile.test.mjs` |
| Market 各階段與 outcome | 已做 | R-NORESEND、R-PROTECT | `test/api-binaFakeMarket.test.mjs` |
| PlaceProtection | 已做 | R-PROTECT | `test/api-binaFakeProtect.test.mjs` |
| MarketEntry | 已做 | R-NORESEND | `test/api-binaFakeMarketEntry.test.mjs` |
| 取消語意 | 已做 | R-CANCEL | `test/api-binaFakeCancel.test.mjs` |
| 殘單判定 | 已做 | R-RESIDUAL | `test/api-binaFakeResidual.test.mjs` |
| 查詢(QueryOrderInfo、QueryOrderByClientId、History、Trades) | 已做 | R-READ | `test/api-binaFakeRead.test.mjs` |
| 現貨第一階段 | 已做;未實測 | R-CLIENT、R-ERRCLASS | `test/api-binaFakeSpot.test.mjs` |
| SDK 升版相容(spot 34.0.5、derivatives 39.0.2、common 2.5.2) | 已做;站點無須改呼叫,僅合約成交明細 `commissionAsset` 之 `null` 正規化為 `''` | R-SDK | `test/api-binaFakeSdkCompat.test.mjs` |
| 連外測試 | 明確啟用(`BINA_LIVE_TEST=1`) | R-TEST | `test/api-binaDemo*.test.mjs` |

## 待辦與已知缺口

### 正式端點首跑驗收(發布後由人執行,全部只有測試端點證據)

1. 市價單 `RESULT` 回 FILLED、欄位、延遲 p99.
2. hedge 模式超量平倉、無部位時條件單觸發是否反向(測試端點反向;結果影響 R-PROTECT 殘餘風險、R-RESIDUAL、先進場後掛保護之理由,§9 一 A).
3. 開啟中同 `clientAlgoId`、`newClientOrderId` 之 -4116;觸發後 ID 不佔位.
4. 查單與部位之落後.
5. `recvWindow`、時鐘差、`-1021` 兩種訊息.
6. 延遲尖峰之真實持續時間(定 `BINA_TIMEOUT_MS`,暫定 3000).
7. `closePosition`(若採用;§9 三現行為甲維持數量型,待正式端點驗證後複議).

### 現貨第二階段(未做;需現貨測試網金鑰與實測)

現貨查單與撤單之對外操作、未知回查、OCO／OTOCO 之冪等規則與部分成交狀態機、手續費自買入資產扣除時 OCO 數量(`src/opBinaSpotMarket.mjs` 之 quantity,P32 未實測).

### 尚未盤點之交易專案

實際交易專案未盤點(使用者已決延後):須配合 README〈Breaking changes〉與〈呼叫端義務〉,現況是否已把 tdid 與意圖落盤未知.

### 待裁示

- §9 二:逾時、過視窗查無、部位未變之回報.暫依甲(`NOT_ENTERED`,帶 `confirmedBy`);改動點為 `src/reconcileBinaOrder.mjs` 之 `judgeNotExecuted`.

### 已知限制

- `timeout` 為閒置型:回應緩慢滴入可超過 `timeout`;SDK 無 abort 接口,刻意不做硬時限.
- 殘餘風險(測試端點皆反向):止損掛好後、止盈送出前觸發(約 600ms 窗),止盈成孤單;一腳成交後另一腳留到下一次 CancelResidual;其他流程或人工減倉後,數量型保護單超量.
- 測試帳戶之 `closePosition` 固定超量異常,來源未明;本套件不用它.
- 合約 `accountTradeList` 依 SDK 39 文件僅可查近 3 個月(原 6 個月),為交易所端限制,本套件不設範圍,超出者由交易所回覆.
- `@binance/common` 之 `NetworkError.transportCode`(如 `ECONNREFUSED`)刻意不用於判定:單憑傳輸層代碼不足以斷定請求未到達交易所,錯誤分類維持 `NetworkError` 一律未知.

## 最近一次驗證

2026-11-03 bf297:離線 283 案全綠(unit＋假伺服器,含 53 站 × 28 結果矩陣);變異 92 條擊殺 91、存活 1 條為等價變異(M34);外審 A、B 各一輪,屬實者已修,C 類額度用盡略過.**連外測試(`test/api-binaDemo*.test.mjs`)尚未跑**:測試鎖未取得,成功回應欄位之嚴格比對(`shapePlaced`、`shapeOrderQuery`、`shapePositions`、`shapeCancel`)與 `httpsAgent keepAlive:false` 未經真實端點驗證,發布前須跑.尚未發布,版本未變(1.0.33).`dist/` 未重建(發布流程自動產製);暫存試打包 UMD 成功,18 支匯出齊全.
