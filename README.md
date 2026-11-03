# w-exchange-binance
A wrapper for binance.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-exchange-binance.svg?style=flat)](https://npmjs.org/package/w-exchange-binance) 
[![license](https://img.shields.io/npm/l/w-exchange-binance.svg?style=flat)](https://npmjs.org/package/w-exchange-binance) 
[![npm download](https://img.shields.io/npm/dt/w-exchange-binance.svg)](https://npmjs.org/package/w-exchange-binance) 
[![npm download](https://img.shields.io/npm/dm/w-exchange-binance.svg)](https://npmjs.org/package/w-exchange-binance) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-exchange-binance.svg)](https://www.jsdelivr.com/package/npm/w-exchange-binance)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-exchange-binance/WExchangeBinance.html).

## Installation

### Using npm(ES6 module):
```alias
npm i w-exchange-binance
```

#### Example
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-exchange-binance/blob/master/g.mjs)]
```alias
import getSettings from './src/getSettings.mjs'
import webina from './src/WExchangeBinance.mjs'

let st = getSettings()

let main = async() => {

    let res = await webina.opBinaContractListOrders(st)
    console.log('res', res)
    // res [
    //   {
    //     //algo 原生欄位
    //     algoId: 1000000097809196,
    //     clientAlgoId: 'tdid-20251206194325-Zqaa49_SL',
    //     algoType: 'CONDITIONAL',
    //     orderType: 'STOP_MARKET',
    //     symbol: 'ETHUSDT',
    //     side: 'SELL',
    //     positionSide: 'LONG',
    //     timeInForce: 'GTC',
    //     quantity: '0.014',
    //     algoStatus: 'NEW',
    //     actualOrderId: '',
    //     actualPrice: '0.00000',
    //     triggerPrice: '1469.50',
    //     price: '0.00',
    //     icebergQuantity: null,
    //     tpOrderType: '',
    //     selfTradePreventionMode: 'EXPIRE_MAKER',
    //     workingType: 'MARK_PRICE',
    //     priceMatch: 'NONE',
    //     closePosition: false,
    //     priceProtect: false,
    //     reduceOnly: true,
    //     createTime: 1765021407346,
    //     updateTime: 1765021407346,
    //     triggerTime: 0,
    //     goodTillDate: 0,
    //     //mirror 對齊普通單欄位 + isAlgo 旗標 (見 opBinaContractListOrders)
    //     orderId: '1000000097809196', //= cstr(algoId)
    //     clientOrderId: 'tdid-20251206194325-Zqaa49_SL',
    //     status: 'NEW', //= algoStatus
    //     type: 'STOP_MARKET', //= orderType
    //     stopPrice: '1469.50', //= triggerPrice
    //     isAlgo: true
    //   },
    //   {
    //     //第二筆為 TP, 結構同上, 差異欄位:
    //     algoId: 1000000097809210,
    //     clientAlgoId: 'tdid-20251206194325-Zqaa49_TP',
    //     orderType: 'TAKE_PROFIT_MARKET',
    //     triggerPrice: '1670.59',
    //     type: 'TAKE_PROFIT_MARKET', //= orderType
    //     stopPrice: '1670.59', //= triggerPrice
    //     isAlgo: true
    //     //...其餘欄位同上
    //   }
    // ]

}
await main()
    .catch((err) => {
        console.log(err)
    })
```

## Breaking changes

本版改寫逾時、重試與下單狀態未知之處理,不留相容層.`package.json` 之版本由發布流程決定;以下皆須依賴方配合.

| 變更 | 舊 | 新 | 依賴方動作 |
|---|---|---|---|
| Market 失敗 | `err.resEntry`/`resSl`/`resTp` | `err.outcome`、`err.state`、`err.execState` | 改依 `outcome` 分流;**`ENTRY_UNKNOWN` 不得重下**;`ENTERED_*` 自行決定補掛(`opBinaContractPlaceProtection`)、平倉 |
| Market 同 tdid | 重複進場 | `TDID_USED`、`TDID_IN_FLIGHT`(`execState:'unknown'`、`state.sentThisCall:false`:本次未送單,前次可能已成交,不得換新 ID 重下) | 每筆 tdid 全域唯一;查得 0 成交終局者再呼叫亦得 `TDID_USED`,須換新 |
| tdid 字元 | 伺服器擋 36 字元 | 本機擋 30 字元,**不得含 `_`**,只收 `A-Z a-z 0-9 . : / -` | 檢查產生規則(`tdid-<14>-<6>` 為 26 字元,可) |
| Market `quantity`、`uTradeReal` | 下單量、估值 | 實際成交量與其估值;另加 `notes` | 通常相同;`priceStart` 仍為標記價 |
| 取消回傳 | SDK 原樣;-2011 拋 | `{ state, alreadyClosed, positionChanged, executedQty, res }`;-2011 不再拋;另可傳 `{ clientOrderId }`、`{ clientAlgoId }`;`NOT_FOUND` 時 `positionChanged` 為 `null`(未驗部位) | 判 `state`、`positionChanged` |
| CancelAll、CancelAllAlgo | SDK 原樣;SDK 自動重送 | `{ state, remaining, inFlightUntil, res }`;未知且清單不空時拋且不重送 | 處理 `err.state.remaining` |
| CancelResidual 回傳 | 陣列 | `{ cancelled, closedOtherwise, skipped, failed, unprotected, underProtected }`;兩腳俱在而部位 0 也撤;後兩者依撤單後之剩餘腿計算 | 改取欄位;處理 `failed`、`skipped`、`unprotected`、`underProtected`;**定期呼叫** |
| QueryOrderInfo | `{ error }` | 每腳 `{ found:true, ... }` 或 `{ found:false, errKind, code, msg }`;可只給 `tdid` | 改判 `found`、`errKind`;`NOT_OBSERVED` 不是未執行 |
| MarketEntry | 無 ID;SDK 例外 | 帶 ID(`opt.clientOrderId`,未給自產;**給了而格式無效即拋**,不靜默換 ID);`outcome`(`NOT_EXECUTED`、`UNKNOWN`、`PARTIAL_UNKNOWN`、`ID_USED`);`err.state.clientOrderId`;送單前多查部位(讀不到照送,回查判不了未執行) | 平倉前查部位;傳穩定 ID |
| 錯誤類別 | SDK 類別;三次逾時為無類別 `Error` | 一律 `BinaOpError`,帶 `execState`、`binance`;原錯在 `cause` | 改判 `execState`,勿再比對訊息 |
| 歷史單 | algo 之 `executedQty` 恆 0;tdid 依第一個 `_` 切分 | algo 之 `executedQty` 取 `actualQty`;依字尾解析 | 檢查有無依賴舊值 |
| 參數訊息 | 回顯輸入值 | `invalid <名稱>: must be ...`,不回顯值 | 勿比對舊訊息;`uTrade` 等改以有效數字判定(不收 `Infinity`、`'0x10'`) |
| 設定 | 空 `basePath` 回落正式 | 空值、未設金鑰即拋;`forTest` 配正式端點即拋;`axios.defaults.baseURL` 非空即拋;`CancelAlgoOrder` 另須 `st.symbol` | settings 明設 `basePath`、`basePathTest`;宿主不得設全域 baseURL |
| 現貨 | 無 tdid、一律正式、無 forTest | `opBinaSpotMarket(st, ott, tdid, uTrade, ...)`、`opBinaSpotLimit(st, ott, tdid, price, uTrade, ...)`;依 forTest,預設測試端點;新設定鍵 `binance.basePathSpot`、`basePathSpotTest`、`apiSpotTest`;失敗帶 `outcome`(`BUY_FAILED`、`BUY_ZERO_FILL`、`BUY_UNPROTECTABLE`、`OCO_FAILED`、`OTOCO_FAILED`),零成交改拋錯;`OCO_FAILED` 之 `execState` 為 `executed`(買入已成交),OCO 本身見 `err.state.oco.execState` | settings 明設;傳 tdid;`OCO_FAILED` 不得重買 |
| 耗時(估計,非保證) | 讀最快約 5 秒失敗;進場 1 秒即拋 | 讀最壞約 9.6 秒;進場前全斷線約 10 秒(`NOT_ENTERED`);進場送出後斷線約 11～14 秒(`ENTRY_UNKNOWN`);成交後才斷線約 45 秒(兩腳各預算 20 秒);正常路徑多 1 次 GET(閘)與 1 次部位快照 | 檢查呼叫端自身逾時;**不得以外層逾時放棄後另起新 tdid** |

固定設定:全部 client `timeout:3000`(暫定,單一常數 `BINA_TIMEOUT_MS`)、`retries:0`、`recvWindow:5000`、每請求新連線且回應後即關(不累積閒置連線).新增對外操作 `opBinaContractPlaceProtection`、`opBinaContractQueryOrderByClientId`.

### 呼叫端義務(本套件做不到)

1. 呼叫前把 tdid 與意圖落盤;程序重啟後以 `opBinaContractQueryOrderInfo(st, { tdid })` 查三腳再決定.
2. `ENTRY_UNKNOWN`、`UNKNOWN` 未過 `conclusiveAfter` 不重呼叫;同程序內狀態未知之 ID 不釋放(再呼叫得 `TDID_IN_FLIGHT`、`ID_USED`),查清後須換新.`TDID_USED`、`ID_USED` 不得換新 ID 重下:前次可能已成交,先查清.
3. `ENTERED_*` 須有人或程式接手:保護單仍無法確認時本套件只回報明確錯誤與當下狀態,**不自動平倉**.
4. 定期跑 `opBinaContractCancelResidualOrders`:部位歸 0 而留著之單仍可能觸發並反向(測試端點實測),間隔越短窗越小.
5. 平倉前自行查部位並以實際量下單,穩定之 `clientOrderId` 用於去重:hedge 模式重複或超量平倉會反向成負部位(測試端點實測).
6. 不以 `Promise.race` 包裝下單後另起新 tdid:外層放棄不會中止已送之單.

### `err.outcome`(合約進場)

| outcome | 情形 | 本次是否增加部位 |
|---|---|---|
| `TDID_IN_FLIGHT`、`TDID_USED` | 同 tdid 在途或已用過 | 本次未送單;前次見 `err.state`(`TDID_IN_FLIGHT` 在 `err.state.previous`),前次可能已成交 |
| `NOT_ENTERED` | `err.state.stage`:`precheck`、`setup`、`mark`、`deadline`、`entry` | 否(不代表帳戶無部位;`precheck` 也不代表前次未成交) |
| `ENTRY_UNKNOWN` | 回查無定論 | **未知**;未掛保護;帶 `tSign`、`conclusiveAfter`、`clientOrderId`;不得重送 |
| `ENTERED_PARTIAL_UNKNOWN` | 已知部分成交而終局未明 | 是,至少 `maxExecutedQty`;已**嘗試**以該量掛保護,兩腳結果須判 `err.state.sl`、`err.state.tp`、`err.state.protectOutcome`(`null` 為兩腳皆掛上) |
| `ENTERED_SL_ONLY`、`ENTERED_TP_ONLY`、`ENTERED_UNPROTECTED`、`ENTERED_PROTECTION_UNKNOWN`、`ENTERED_POSITION_CHANGED` | 進場已成交,保護單未全部確認;`reason:conflict` 表同 ID 舊單量價不符而未掛(舊單可能仍在) | 是 |

`err.execState`:`notExecuted` 本次確定未執行、`unknown` 狀態未知(含 `TDID_USED`、`ID_USED`:本次未送單但前次可能已成交);組合操作另有 `executed`(進場或買入已成交,保護單狀態見 `err.state`).`opBinaContractPlaceProtection` 依兩腳實況:有掛上或已觸發為 `executed`,否則有未知為 `unknown`,皆確定未掛為 `notExecuted`;同 ID 已觸發者不再送,要另掛須換新 tdid.

### 未驗證事項

全部行為實測僅於測試端點(`demo-fapi.binance.com`)與本機假伺服器,**發布後須由人依下列清單於正式端點首跑驗收**:

1. 市價單 `RESULT` 回 FILLED、欄位、延遲 p99.
2. hedge 模式超量平倉、無部位時條件單觸發是否反向(測試端點反向;結果影響殘餘風險、殘單判定與「先進場後掛保護」之理由).
3. 開啟中同 `clientAlgoId`、`newClientOrderId` 之 -4116;觸發後 ID 不佔位.
4. 查單與部位之落後.
5. `recvWindow`、時鐘差、`-1021` 兩種訊息.
6. 延遲尖峰之真實持續時間(定 `timeout`).
7. `closePosition`(若採用).

現貨全部未實測.另有「過視窗查無且部位未變即判未執行」為最弱假設,非數學保證.

## Testing

```alias
npm test
```

預設只跑離線測試(本機假伺服器,固定埠 8297,假金鑰);連外測試須明確啟用,且只連測試端點:

```alias
BINA_LIVE_TEST=1 npm test
```
