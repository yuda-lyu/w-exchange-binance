import get from 'lodash-es/get.js'
import cdbl from 'wsemi/src/cdbl.mjs'
import dig from 'wsemi/src/dig.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import { Spot } from '@binance/spot'
import ott from './ott.mjs'


let opBinaSpotLimit = async(st, price, uTrade, rTakeProfit, rStopLoss, opt = {}) => {

    //params
    let API_KEY = get(st, 'binance.apiSpot.key', '')
    let API_SECRET = get(st, 'binance.apiSpot.secret', '')
    let SYMBOL = get(st, 'symbol', '')
    let digPrice = get(st, 'digPrice', '')
    let digSpotQuantity = get(st, 'digSpotQuantity', '')
    // console.log('API_KEY', API_KEY)
    // console.log('API_SECRET', API_SECRET)
    // console.log('SYMBOL', SYMBOL)
    // console.log('digPrice', digPrice)
    // console.log('digSpotQuantity', digSpotQuantity)

    //check
    if (!isnum(price)) {
        throw new Error(`invalid price[${price}]`)
    }
    price = cdbl(price)
    price = dig(price, digPrice)

    //check uTrade
    if (!isnum(uTrade)) {
        throw new Error(`invalid uTrade[${uTrade}]`)
    }
    uTrade = cdbl(uTrade)
    if (uTrade < 6) {
        throw new Error(`uTrade[${uTrade}] < 6(u)`)
    }
    uTrade = dig(uTrade, 2)

    //check rTakeProfit
    if (!isnum(rTakeProfit)) {
        throw new Error(`invalid rTakeProfit[${rTakeProfit}]`)
    }
    rTakeProfit = cdbl(rTakeProfit)
    if (rTakeProfit <= 0) {
        throw new Error(`rTakeProfit[${rTakeProfit}] <= 0`)
    }
    if (rTakeProfit >= 0.25) {
        throw new Error(`rTakeProfit[${rTakeProfit}] >= 0.25`)
    }

    //check rStopLoss
    if (!isnum(rStopLoss)) {
        throw new Error(`invalid rStopLoss[${rStopLoss}]`)
    }
    rStopLoss = cdbl(rStopLoss)
    if (rStopLoss <= 0) {
        throw new Error(`rStopLoss[${rStopLoss}] <= 0`)
    }
    if (rStopLoss >= 0.15) {
        throw new Error(`rStopLoss[${rStopLoss}] >= 0.15`)
    }

    //priceTakeProfit
    let priceTakeProfit = (1 + rTakeProfit) * cdbl(price) //下單設定止盈價格(USDT)
    priceTakeProfit = dig(priceTakeProfit, digPrice)
    // console.log('priceTakeProfit', priceTakeProfit)

    //priceStopLoss
    let priceStopLoss = (1 - rStopLoss) * cdbl(price) //下單設定止損價格(USDT)
    priceStopLoss = dig(priceStopLoss, digPrice)
    // console.log('priceStopLoss', priceStopLoss)

    //client
    let configurationRestAPI = {
        apiKey: API_KEY,
        apiSecret: API_SECRET,
    }
    let client = new Spot({ configurationRestAPI })

    // let mode = 'long'

    //quantity, 須調整至最小購買數量
    //須用10**x次方而非10^x: JS的^是XOR會把quantity數量級錯位(例:0.009變3顆), 下一行dig只截位數救不了
    let quantity = cdbl(uTrade) / cdbl(price)
    quantity = Math.floor(quantity * (10 ** digSpotQuantity)) / (10 ** digSpotQuantity)
    quantity = dig(quantity, digSpotQuantity)
    // console.log('quantity', quantity)

    //orderListOtoco
    let rf = await client.restAPI.orderListOtoco({

        symbol: SYMBOL,

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

    })

    //res
    let res = await rf.data()
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

    //check
    if (res === null) {
        console.log('rf', rf)
        throw new Error(`invalid rf.data`)
    }
    if (haskey(res, 'code') && res.code !== 0) {
        console.log('res', res)
        let msg = get(res, 'msg', '')
        throw new Error(msg)
    }

    //id
    let id = get(res, 'orderListId', '')

    //time
    let transactionTime = get(res, 'transactionTime', '')
    let time = ott(transactionTime).format('YYYY-MM-DDTHH:mm:ss')

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
