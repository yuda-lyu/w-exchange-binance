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