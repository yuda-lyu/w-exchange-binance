import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import cstr from 'wsemi/src/cstr.mjs'
import callBinaRead from './callBinaRead.mjs'
import { shapeArr } from './classifyBinaErr.mjs'
import getBinaClient from './getBinaClient.mjs'


/**
 * 列當前未成交單(普通單與algo單), 讀取失敗拋BinaOpError(err.execState、err.binance.attempts)
 *
 * @param {Object} st 設定物件
 * @param {Object} [opt={}] forceTest, onTrace
 * @returns {Promise} resolve單陣列
 */
let opBinaContractListOrders = async(st, opt = {}) => {

    //client
    let { client, SYMBOL, recvWindow } = getBinaClient(st, opt)
    let onTrace = get(opt, 'onTrace', null)

    //普通單
    let normalOrders = await callBinaRead(() => client.restAPI.currentAllOpenOrders({ symbol: SYMBOL, recvWindow }), { name: 'openOrders', shape: shapeArr, onTrace })

    //algo單(2025-12-09起Binance將條件單TP/SL強制走algoOrder)
    let algoOrders = await callBinaRead(() => client.restAPI.currentAllAlgoOpenOrders({ symbol: SYMBOL, recvWindow }), { name: 'openAlgoOrders', shape: shapeArr, onTrace })

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
