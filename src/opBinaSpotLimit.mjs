import get from 'lodash-es/get.js'
import cdbl from 'wsemi/src/cdbl.mjs'
import dig from 'wsemi/src/dig.mjs'
import isenum from 'wsemi/src/isenum.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isp0int from 'wsemi/src/isp0int.mjs'
import { sendBina, shapeObj, toBinaOpError } from './classifyBinaErr.mjs'
import { getBinaSpotClient } from './getBinaClient.mjs'


//現貨之自訂ID限制為^[a-zA-Z0-9-_]{1,36}$, tdid不含底線, 字尾_OTOCO另占6字元
let REG_TDID_SPOT = /^[A-Za-z0-9-]{1,30}$/


/**
 * 現貨限價買入並帶止盈止損(OTOCO)
 *
 * 僅第一階段: 依forTest選端點與金鑰(預設測試端點), 帶自訂ID, 錯誤帶execState; 現貨未實測, 未知回查與冪等規則屬第二階段, 不宣稱與合約同級
 * 狀態未知時拋BinaOpError(err.outcome='OTOCO_FAILED', err.execState='unknown', err.state.listClientOrderId), 呼叫端以該ID自行查清, 不得盲目重送
 *
 * @param {Object} st 設定物件, 用binance.basePathSpot、basePathSpotTest、apiSpot、apiSpotTest
 * @param {Function} ott 時間函數
 * @param {String} tdid 交易識別字, ^[A-Za-z0-9-]{1,30}$, 實際ID為tdid_OTOCO
 * @param {Number|String} price 限價(有效數字)
 * @param {Number|String} uTrade 下單金額(有效數字), 不低於6
 * @param {Number|String} rTakeProfit 止盈比例, 大於0小於0.25
 * @param {Number|String} rStopLoss 止損比例, 大於0小於0.15
 * @param {Object} [opt={}] forceTest
 * @returns {Promise} resolve成功結果, reject BinaOpError
 */
let opBinaSpotLimit = async(st, ott, tdid, price, uTrade, rTakeProfit, rStopLoss, opt = {}) => {

    //check
    if (!isfun(ott)) {
        throw new Error(`invalid ott: must be a function`)
    }
    if (typeof tdid !== 'string' || !REG_TDID_SPOT.test(tdid)) {
        throw new Error(`invalid tdid: must be a string of 1 to 30 characters from A-Z a-z 0-9 -`)
    }

    //params
    let digPrice = get(st, 'digPrice', '')
    let digSpotQuantity = get(st, 'digSpotQuantity', '')
    if (!isp0int(digPrice)) {
        throw new Error(`invalid st.digPrice: must be a non-negative integer`)
    }
    if (!isp0int(digSpotQuantity)) {
        throw new Error(`invalid st.digSpotQuantity: must be a non-negative integer`)
    }

    //check
    if (!isenum(price) || cdbl(price) <= 0) {
        throw new Error(`invalid price: must be a positive number`)
    }
    price = cdbl(price)
    price = dig(price, digPrice)

    //check uTrade
    if (!isenum(uTrade) || cdbl(uTrade) < 6) {
        throw new Error(`invalid uTrade: must be a number not less than 6`)
    }
    uTrade = cdbl(uTrade)
    uTrade = dig(uTrade, 2)

    //check rTakeProfit
    if (!isenum(rTakeProfit) || cdbl(rTakeProfit) <= 0 || cdbl(rTakeProfit) >= 0.25) {
        throw new Error(`invalid rTakeProfit: must be a number greater than 0 and less than 0.25`)
    }
    rTakeProfit = cdbl(rTakeProfit)

    //check rStopLoss
    if (!isenum(rStopLoss) || cdbl(rStopLoss) <= 0 || cdbl(rStopLoss) >= 0.15) {
        throw new Error(`invalid rStopLoss: must be a number greater than 0 and less than 0.15`)
    }
    rStopLoss = cdbl(rStopLoss)

    //client
    let { client, SYMBOL, recvWindow } = getBinaSpotClient(st, opt)

    //priceTakeProfit
    let priceTakeProfit = (1 + rTakeProfit) * cdbl(price) //下單設定止盈價格(USDT)
    priceTakeProfit = dig(priceTakeProfit, digPrice)
    // console.log('priceTakeProfit', priceTakeProfit)

    //priceStopLoss
    let priceStopLoss = (1 - rStopLoss) * cdbl(price) //下單設定止損價格(USDT)
    priceStopLoss = dig(priceStopLoss, digPrice)
    // console.log('priceStopLoss', priceStopLoss)

    // let mode = 'long'

    //quantity, 須調整至最小購買數量
    //須用10**x次方而非10^x: JS的^是XOR會把quantity數量級錯位(例:0.009變3顆), 下一行dig只截位數救不了
    let quantity = cdbl(uTrade) / cdbl(price)
    quantity = Math.floor(quantity * (10 ** digSpotQuantity)) / (10 ** digSpotQuantity)
    quantity = dig(quantity, digSpotQuantity)
    // console.log('quantity', quantity)

    //orderListOtoco
    let listClientOrderId = `${tdid}_OTOCO`
    let res = null
    try {
        res = await sendBina(() => client.restAPI.orderListOtoco({

            symbol: SYMBOL,
            listClientOrderId,
            recvWindow,

            //工作單, 現貨限價買入
            workingType: 'LIMIT',
            workingSide: 'BUY',
            workingPrice: price, //掛單買入價
            workingQuantity: quantity,
            workingTimeInForce: 'GTC',

            //出場單, 同一方向SELL, 數量要<=實際持倉
            pendingSide: 'SELL',
            pendingQuantity: quantity,

            //止盈, 上方pendingAbove
            pendingAboveType: 'TAKE_PROFIT_LIMIT',
            pendingAbovePrice: priceTakeProfit, //限價
            pendingAboveStopPrice: priceTakeProfit, //觸發價
            pendingAboveTimeInForce: 'GTC', //有效直到取消

            //止損, 下方pendingBelow
            pendingBelowType: 'STOP_LOSS_LIMIT',
            pendingBelowPrice: priceStopLoss, //限價
            pendingBelowStopPrice: priceStopLoss, //觸發價
            pendingBelowTimeInForce: 'GTC', //有效直到取消

        }), (b) => shapeObj(b) && get(b, 'orderListId', null) !== null && b.listClientOrderId === listClientOrderId && Array.isArray(b.orders) && b.orders.length >= 3)
    }
    catch (err) {
        throw toBinaOpError(err, { name: 'opBinaSpotLimit', outcome: 'OTOCO_FAILED', state: { tdid, listClientOrderId } })
    }
    // console.log('res', res)
    // {
    //   orderListId: 17230397208,
    //   contingencyType: 'OTO',
    //   listStatusType: 'EXEC_STARTED',
    //   listOrderStatus: 'EXECUTING',
    //   listClientOrderId: 'ggajC7Gyp8nPCMFFxIH3gB',
    //   transactionTime: 1764489115511,
    //   symbol: 'ETHUSDT',
    //   orders: [
    //     {
    //       symbol: 'ETHUSDT',
    //       orderId: 53077830643,
    //       clientOrderId: 'jhsKDpFtev0AfW11YUJCrz'
    //     },
    //     {
    //       symbol: 'ETHUSDT',
    //       orderId: 53077830644,
    //       clientOrderId: '9r67wQO8gtY3VzrVZRHOFZ'
    //     },
    //     {
    //       symbol: 'ETHUSDT',
    //       orderId: 53077830645,
    //       clientOrderId: 'CWHHLfwM5pw8kAAgApe5DA'
    //     }
    //   ],
    //   orderReports: [
    //     {
    //       symbol: 'ETHUSDT',
    //       orderId: 53077830643,
    //       orderListId: 17230397208,
    //       clientOrderId: 'jhsKDpFtev0AfW11YUJCrz',
    //       transactTime: 1764489115511,
    //       price: '90000.00000000',
    //       origQty: '0.00006000',
    //       executedQty: '0.00000000',
    //       origQuoteOrderQty: '0.00000000',
    //       cummulativeQuoteQty: '0.00000000',
    //       status: 'NEW',
    //       timeInForce: 'GTC',
    //       type: 'LIMIT',
    //       side: 'BUY',
    //       workingTime: 1764489115511,
    //       selfTradePreventionMode: 'EXPIRE_MAKER'
    //     },
    //     {
    //       symbol: 'ETHUSDT',
    //       orderId: 53077830644,
    //       orderListId: 17230397208,
    //       clientOrderId: '9r67wQO8gtY3VzrVZRHOFZ',
    //       transactTime: 1764489115511,
    //       price: '85500.00000000',
    //       origQty: '0.00006000',
    //       executedQty: '0.00000000',
    //       origQuoteOrderQty: '0.00000000',
    //       cummulativeQuoteQty: '0.00000000',
    //       status: 'PENDING_NEW',
    //       timeInForce: 'GTC',
    //       type: 'STOP_LOSS_LIMIT',
    //       side: 'SELL',
    //       stopPrice: '85500.00000000',
    //       workingTime: -1,
    //       selfTradePreventionMode: 'EXPIRE_MAKER'
    //     },
    //     {
    //       symbol: 'ETHUSDT',
    //       orderId: 53077830645,
    //       orderListId: 17230397208,
    //       clientOrderId: 'CWHHLfwM5pw8kAAgApe5DA',
    //       transactTime: 1764489115511,
    //       price: '94500.00000000',
    //       origQty: '0.00006000',
    //       executedQty: '0.00000000',
    //       origQuoteOrderQty: '0.00000000',
    //       cummulativeQuoteQty: '0.00000000',
    //       status: 'PENDING_NEW',
    //       timeInForce: 'GTC',
    //       type: 'TAKE_PROFIT_LIMIT',
    //       side: 'SELL',
    //       stopPrice: '94500.00000000',
    //       workingTime: -1,
    //       selfTradePreventionMode: 'EXPIRE_MAKER'
    //     }
    //   ]
    // }

    //id
    let id = get(res, 'orderListId', '')

    //time
    //此時單已成立, 呼叫端傳入之時間函數失敗不得讓結果遺失
    let time = ''
    try {
        time = ott(get(res, 'transactionTime', '')).format('YYYY-MM-DDTHH:mm:ss')
    }
    catch (err) {
        time = ''
    }

    //symbol
    let symbol = get(res, 'symbol', '')

    //r
    let r = {

        id,
        time,
        symbol,

        quantity,

        timeStart: time,
        priceStart: price,
        uTrade,

        rTakeProfit,
        priceTakeProfit,
        rStopLoss,
        priceStopLoss,

        res,

    }

    return r
}


export default opBinaSpotLimit
