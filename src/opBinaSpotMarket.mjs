import get from 'lodash-es/get.js'
import cdbl from 'wsemi/src/cdbl.mjs'
import dig from 'wsemi/src/dig.mjs'
import isenum from 'wsemi/src/isenum.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isp0int from 'wsemi/src/isp0int.mjs'
import { BinaOpError, sendBina, shapeObj, toBinaOpError } from './classifyBinaErr.mjs'
import { getBinaSpotClient } from './getBinaClient.mjs'


//現貨之自訂ID限制為^[a-zA-Z0-9-_]{1,36}$, tdid不含底線
let REG_TDID_SPOT = /^[A-Za-z0-9-]{1,30}$/


let STATUS_TERMINAL = ['CANCELED', 'EXPIRED', 'REJECTED', 'EXPIRED_IN_MATCH']


//以十進位字串截位至d位小數; 非一般十進位寫法者退回數值向下取整
let truncQty = (v, d) => {
    let s = String(v).trim()
    if (!/^\d+(\.\d+)?$/.test(s)) {
        return dig(Math.floor(cdbl(v) * (10 ** d)) / (10 ** d), d)
    }
    let [a, b = ''] = s.split('.')
    return d > 0 ? `${a}.${b.padEnd(d, '0').slice(0, d)}` : a
}


/**
 * 現貨市價買入後掛止盈止損(OCO)
 *
 * 僅第一階段: 依forTest選端點與金鑰(預設測試端點), 帶自訂ID, 錯誤帶execState; 現貨未實測, 未知回查與冪等規則屬第二階段, 不宣稱與合約同級
 * err.outcome: BUY_FAILED(買入失敗或未知, err.execState區分), BUY_ZERO_FILL(零成交), BUY_UNPROTECTABLE(已買入而數量或金額不足以掛OCO, err.execState為'executed'), OCO_FAILED(已買入而OCO失敗, err.execState為'executed', err.state.buy帶買入資訊, err.state.oco.execState區分OCO確定未掛或未知)
 * 狀態未知時呼叫端以err.state內之自訂ID自行查清, 不得盲目重送
 *
 * @param {Object} st 設定物件, 用binance.basePathSpot、basePathSpotTest、apiSpot、apiSpotTest
 * @param {Function} ott 時間函數
 * @param {String} tdid 交易識別字, ^[A-Za-z0-9-]{1,30}$, 實際ID為tdid_BUY、tdid_OCO
 * @param {Number|String} uTrade 下單金額(有效數字), 不低於6
 * @param {Number|String} rTakeProfit 止盈比例, 大於0小於0.25
 * @param {Number|String} rStopLoss 止損比例, 大於0小於0.15
 * @param {Object} [opt={}] forceTest
 * @returns {Promise} resolve成功結果, reject BinaOpError
 */
let opBinaSpotMarket = async(st, ott, tdid, uTrade, rTakeProfit, rStopLoss, opt = {}) => {

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

    // let mode = 'long'

    let clientOrderIdBuy = `${tdid}_BUY`
    let listClientOrderId = `${tdid}_OCO`

    //市價購買
    let resBuy = null
    try {

        //newOrder
        resBuy = await sendBina(() => client.restAPI.newOrder({
            symbol: SYMBOL,
            side: 'BUY',
            type: 'MARKET',
            //用市價(USDT)買
            quoteOrderQty: uTrade,
            newClientOrderId: clientOrderIdBuy,
            recvWindow,
        }), (b) => shapeObj(b) && get(b, 'orderId', null) !== null && isestr(b.status) && isenum(b.executedQty) && b.clientOrderId === clientOrderIdBuy)
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
        throw toBinaOpError(err, { name: 'opBinaSpotMarket', outcome: 'BUY_FAILED', state: { tdid, buy: { status: 'failed', clientOrderId: clientOrderIdBuy } } })
    }

    //qtyRaw, 成交的數量, 判定有無買到一律用原始值
    let qtyRaw = cdbl(get(resBuy, 'executedQty', 0))

    //quantity, 掛OCO之數量: 以十進位字串截位, 浮點乘法會把0.29截成0.28而少保護
    let quantity = truncQty(get(resBuy, 'executedQty', '0'), digSpotQuantity)
    // console.log('quantity', quantity)

    //uCost, 成交消耗的總USDT
    let uCost = cdbl(get(resBuy, 'cummulativeQuoteQty', 0))
    // console.log('uCost', uCost)

    //price, 成交均價, 用原始成交量算, 截位後之量會高估均價
    let price = 0
    if (qtyRaw > 0) {
        price = uCost / qtyRaw
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

    //零成交: 沒買到不得回成功, 終局才算確定未成交, 其餘未知
    let buyInfo = { status: resBuy.status, clientOrderId: clientOrderIdBuy, orderId: String(get(resBuy, 'orderId', '')), executedQty: resBuy.executedQty, cummulativeQuoteQty: get(resBuy, 'cummulativeQuoteQty', ''), res: resBuy }
    if (!(qtyRaw > 0)) {
        throw new BinaOpError(`opBinaSpotMarket failed: BUY_ZERO_FILL`, {
            outcome: 'BUY_ZERO_FILL',
            execState: STATUS_TERMINAL.includes(resBuy.status) ? 'notExecuted' : 'unknown',
            state: { tdid, buy: buyInfo },
        })
    }

    //已買入但無法掛OCO(成交量截位後為0或成交金額缺): 已執行, 不得判未執行
    if (!(cdbl(quantity) > 0 && uCost > 0 && price > 0)) {
        throw new BinaOpError(`opBinaSpotMarket failed: BUY_UNPROTECTABLE`, {
            outcome: 'BUY_UNPROTECTABLE',
            execState: 'executed',
            state: { tdid, buy: buyInfo },
        })
    }

    //有買到, 再掛止盈止損
    let resOco = null

    try {

        //orderListOco, 會上下兩張單, 有不同orderId, 但共用orderListId, 先成交的會自動取消另一邊單
        resOco = await sendBina(() => client.restAPI.orderListOco({

            symbol: SYMBOL,
            side: 'SELL',
            quantity,
            listClientOrderId,
            recvWindow,

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

        }), (b) => shapeObj(b) && get(b, 'orderListId', null) !== null && b.listClientOrderId === listClientOrderId && Array.isArray(b.orders) && b.orders.length >= 2)
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
        //整筆之execState為executed(買入已成交), OCO本身之狀態另列, 呼叫端不得因OCO被拒而當整筆未執行重買
        let e = toBinaOpError(err, { name: 'opBinaSpotMarket', outcome: 'OCO_FAILED', state: { tdid, buy: buyInfo, oco: { listClientOrderId } } })
        e.state.oco.execState = e.execState
        e.execState = 'executed'
        throw e
    }

    //id
    let id = get(resOco, 'orderListId', '')

    //time, 此時買入與OCO皆已成立, 呼叫端傳入之時間函數失敗不得讓結果遺失
    let time = ''
    try {
        time = ott(get(resOco, 'transactionTime', '')).format('YYYY-MM-DDTHH:mm:ss')
    }
    catch (err) {
        time = ''
    }

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
