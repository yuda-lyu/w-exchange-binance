import get from 'lodash-es/get.js'
import cdbl from 'wsemi/src/cdbl.mjs'
import dig from 'wsemi/src/dig.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import { Spot } from '@binance/spot'
import ott from './ott.mjs'


let opBinaSpotMarket = async(st, uTrade, rTakeProfit, rStopLoss, opt = {}) => {

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

    //client
    let configurationRestAPI = {
        apiKey: API_KEY,
        apiSecret: API_SECRET,
    }
    let client = new Spot({ configurationRestAPI })

    // let mode = 'long'

    //市價購買
    let resBuy = null
    try {

        //newOrder
        let rf = await client.restAPI.newOrder({
            symbol: SYMBOL,
            side: 'BUY',
            type: 'MARKET',
            //用市價(USDT)買
            quoteOrderQty: uTrade,
        })

        //resBuy
        resBuy = await rf.data()
        // console.log('resBuy', resBuy)
        // resBuy {
        //   symbol: 'ETHUSDT',
        //   orderId: 53086303200,
        //   orderListId: -1,
        //   clientOrderId: 'vyGTQhuOX3tYOG16FQxuad',
        //   transactTime: 1764509493653,
        //   price: '0.00000000',
        //   origQty: '0.00006000',
        //   executedQty: '0.00006000',
        //   origQuoteOrderQty: '6.00000000',
        //   cummulativeQuoteQty: '5.50694220',
        //   status: 'FILLED',
        //   timeInForce: 'GTC',
        //   type: 'MARKET',
        //   side: 'BUY',
        //   workingTime: 1764509493653,
        //   fills: [
        //     {
        //       price: '91782.37000000',
        //       qty: '0.00006000',
        //       commission: '0.00000464',
        //       commissionAsset: 'BNB',
        //       tradeId: 5583330631
        //     }
        //   ],
        //   selfTradePreventionMode: 'EXPIRE_MAKER'
        // }

    }
    catch (err) {
        console.log(err)
        throw err
    }

    //check
    if (haskey(resBuy, 'code') && resBuy.code !== 0) {
        console.log('resBuy', resBuy)
        let msg = get(resBuy, 'msg', '')
        throw new Error(msg)
    }

    //quantity, 成交的數量
    let quantity = cdbl(get(resBuy, 'executedQty', 0))
    //須用10**x次方而非10^x: JS的^是XOR會把quantity數量級錯位
    quantity = Math.floor(quantity * (10 ** digSpotQuantity)) / (10 ** digSpotQuantity)
    // console.log('quantity', quantity)

    //uCost, 成交消耗的總USDT
    let uCost = cdbl(get(resBuy, 'cummulativeQuoteQty', 0))
    // console.log('uCost', uCost)

    //price, 成交均價
    let price = 0
    if (quantity > 0) {
        price = uCost / quantity
    }
    // console.log('price', price)

    //priceTakeProfit
    let priceTakeProfit = (1 + rTakeProfit) * price //下單設定止盈價格(USDT)
    priceTakeProfit = dig(priceTakeProfit, digPrice)
    // console.log('priceTakeProfit', priceTakeProfit)

    //priceStopLoss
    let priceStopLoss = (1 - rStopLoss) * price //下單設定止損價格(USDT)
    priceStopLoss = dig(priceStopLoss, digPrice)
    // console.log('priceStopLoss', priceStopLoss)

    //有買到, 再掛止盈止損
    let resOco = null
    if (quantity > 0 && uCost > 0 && price > 0) {

        //quantity, 直接使用買入的executedQty
        quantity = dig(quantity, digSpotQuantity)
        // console.log('quantity', quantity)

        try {

            //orderListOco, 會上下兩張單, 有不同orderId, 但共用orderListId, 先成交的會自動取消另一邊單
            let rf = await client.restAPI.orderListOco({

                symbol: SYMBOL,
                side: 'SELL',
                quantity,

                //止盈, 上方above
                aboveType: 'TAKE_PROFIT_LIMIT',
                abovePrice: priceTakeProfit, //限價
                aboveStopPrice: priceTakeProfit, //觸發價
                aboveTimeInForce: 'GTC', //有效直到取消

                //止損, 下方below
                belowType: 'STOP_LOSS',
                // belowPrice: priceStopLoss, //不須給限價, 達觸發價就用市價賣
                belowStopPrice: priceStopLoss, //觸發價
                belowTimeInForce: 'GTC', //有效直到取消

            })

            //resOco
            resOco = await rf.data()
            // console.log('resOco', resOco)
            // resOco {
            //   orderListId: 17235633322,
            //   contingencyType: 'OCO',
            //   listStatusType: 'EXEC_STARTED',
            //   listOrderStatus: 'EXECUTING',
            //   listClientOrderId: '1fgIGZXTo4USrPLGFug0XV',
            //   transactionTime: 1764509493718,
            //   symbol: 'ETHUSDT',
            //   orders: [
            //     {
            //       symbol: 'ETHUSDT',
            //       orderId: 53086303343,
            //       clientOrderId: 'llcoTzne1lPPtMC05uhJX7'
            //     },
            //     {
            //       symbol: 'ETHUSDT',
            //       orderId: 53086303344,
            //       clientOrderId: 'dkA6d5MdlyylMp7xcpiimV'
            //     }
            //   ],
            //   orderReports: [
            //     {
            //       symbol: 'ETHUSDT',
            //       orderId: 53086303343,
            //       orderListId: 17235633322,
            //       clientOrderId: 'llcoTzne1lPPtMC05uhJX7',
            //       transactTime: 1764509493718,
            //       price: '90864.55000000',
            //       origQty: '0.00006000',
            //       executedQty: '0.00000000',
            //       origQuoteOrderQty: '0.00000000',
            //       cummulativeQuoteQty: '0.00000000',
            //       status: 'NEW',
            //       timeInForce: 'GTC',
            //       type: 'STOP_LOSS_LIMIT',
            //       side: 'SELL',
            //       stopPrice: '90864.55000000',
            //       workingTime: -1,
            //       selfTradePreventionMode: 'EXPIRE_MAKER'
            //     },
            //     {
            //       symbol: 'ETHUSDT',
            //       orderId: 53086303344,
            //       orderListId: 17235633322,
            //       clientOrderId: 'dkA6d5MdlyylMp7xcpiimV',
            //       transactTime: 1764509493718,
            //       price: '93618.02000000',
            //       origQty: '0.00006000',
            //       executedQty: '0.00000000',
            //       origQuoteOrderQty: '0.00000000',
            //       cummulativeQuoteQty: '0.00000000',
            //       status: 'NEW',
            //       timeInForce: 'GTC',
            //       type: 'TAKE_PROFIT_LIMIT',
            //       side: 'SELL',
            //       stopPrice: '93618.02000000',
            //       workingTime: -1,
            //       selfTradePreventionMode: 'EXPIRE_MAKER'
            //     }
            //   ]
            // }

        }
        catch (err) {
            console.log(err)
            throw err
        }

    }

    //check
    if (haskey(resOco, 'code') && resOco.code !== 0) {
        console.log('resOco', resOco)
        let msg = get(resOco, 'msg', '')
        throw new Error(msg)
    }

    //id
    let id = get(resOco, 'orderListId', '')

    //time
    let transactionTime = get(resOco, 'transactionTime', '')
    let time = ott(transactionTime).format('YYYY-MM-DDTHH:mm:ss')

    //symbol
    let symbol = get(resOco, 'symbol', '')

    //r
    let r = {

        id,
        symbol,

        quantity,

        timeStart: time,
        priceStart: price,
        uTrade,
        uTradeReal: uCost,

        rTakeProfit,
        priceTakeProfit,

        rStopLoss,
        priceStopLoss,

        resBuy,
        resOco,

    }

    return r
}


export default opBinaSpotMarket
