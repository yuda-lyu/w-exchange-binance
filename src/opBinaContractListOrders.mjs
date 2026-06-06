import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import cstr from 'wsemi/src/cstr.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures'


let opBinaContractListOrders = async(st, opt = {}) => {

    //params
    let forceTest = get(opt, 'forceTest', null)
    let forTestAll = get(st, 'forTestAll', null)
    let forTest = get(st, 'binance.forTest', null)
    if (isbol(forceTest)) {
        forTest = forceTest
    }
    else if (isbol(forTestAll)) {
        forTest = forTestAll
    }
    else if (!isbol(forTest)) {
        forTest = true
    }
    let keyApiContract = 'apiContract'
    if (forTest) {
        keyApiContract = 'apiContractTest'
    }
    //basePath 由 settings 決定: forTest=true 用 binance.basePathTest (測試端點); forTest=false 用 binance.basePath (正式端點)
    let basePath = forTest ? get(st, 'binance.basePathTest', '') : get(st, 'binance.basePath', '')
    let API_KEY = get(st, `binance.${keyApiContract}.key`, '')
    let API_SECRET = get(st, `binance.${keyApiContract}.secret`, '')
    let SYMBOL = get(st, 'symbol', '')
    // console.log('API_KEY', API_KEY)
    // console.log('API_SECRET', API_SECRET)
    // console.log('SYMBOL', SYMBOL)

    //client
    let configurationRestAPI = {
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        basePath,
    }
    let client = new DerivativesTradingUsdsFutures({ configurationRestAPI })

    //普通單
    let opOrs = await client.restAPI.currentAllOpenOrders({ symbol: SYMBOL })
    let normalOrders = await opOrs.data()

    //algo單(2025-12-09起Binance將條件單TP/SL強制走algoOrder)
    let opAlgoOrs = await client.restAPI.currentAllAlgoOpenOrders({ symbol: SYMBOL })
    let algoOrders = await opAlgoOrs.data()

    //合併。algo單把algoId/clientAlgoId同時mirror到orderId/clientOrderId讓既有下游零改動,
    //但保留原欄位 + 加isAlgo旗標讓需要區分的下游可dispatch
    let orders = [
        ...map(normalOrders, (o) => ({ ...o, isAlgo: false })),
        ...map(algoOrders, (o) => ({
            ...o,
            orderId: cstr(o.algoId), //BigInt安全
            clientOrderId: o.clientAlgoId,
            status: o.algoStatus, //algo單狀態欄位是algoStatus, 對齊普通單的status
            type: o.orderType, //algo單類型欄位是orderType, 對齊普通單的type
            stopPrice: o.triggerPrice, //algo單觸發價是triggerPrice, 對齊普通單的stopPrice
            isAlgo: true,
        })),
    ]
    // console.log('orders', orders)
    // orders [
    //   {
    //     orderId: 7605276920,
    //     symbol: 'ETHUSDT',
    //     status: 'NEW',
    //     clientOrderId: 'tdid-20251206194325-Zqaa49_SL',
    //     price: '0',
    //     avgPrice: '0',
    //     origQty: '0.007',
    //     executedQty: '0',
    //     cumQuote: '0.00000',
    //     timeInForce: 'GTC',
    //     type: 'STOP_MARKET',
    //     reduceOnly: true,
    //     closePosition: false,
    //     side: 'SELL',
    //     positionSide: 'BOTH',
    //     stopPrice: '3030.65',
    //     workingType: 'MARK_PRICE',
    //     priceProtect: false,
    //     origType: 'STOP_MARKET',
    //     priceMatch: 'NONE',
    //     selfTradePreventionMode: 'EXPIRE_MAKER',
    //     goodTillDate: 0,
    //     time: 1765021407346,
    //     updateTime: 1765021407346
    //   },
    //   {
    //     orderId: 7605276918,
    //     symbol: 'ETHUSDT',
    //     status: 'NEW',
    //     clientOrderId: 'tdid-20251206194325-Zqaa49_TP',
    //     price: '0',
    //     avgPrice: '0',
    //     origQty: '0.007',
    //     executedQty: '0',
    //     cumQuote: '0.00000',
    //     timeInForce: 'GTC',
    //     type: 'TAKE_PROFIT_MARKET',
    //     reduceOnly: true,
    //     closePosition: false,
    //     side: 'SELL',
    //     positionSide: 'BOTH',
    //     stopPrice: '3048.87',
    //     workingType: 'MARK_PRICE',
    //     priceProtect: false,
    //     origType: 'TAKE_PROFIT_MARKET',
    //     priceMatch: 'NONE',
    //     selfTradePreventionMode: 'EXPIRE_MAKER',
    //     goodTillDate: 0,
    //     time: 1765021407201,
    //     updateTime: 1765021407201
    //   }
    // ]

    return orders
}


export default opBinaContractListOrders
