import get from 'lodash-es/get.js'
import cdbl from 'wsemi/src/cdbl.mjs'
import cstr from 'wsemi/src/cstr.mjs'
import delay from 'wsemi/src/delay.mjs'
import dig from 'wsemi/src/dig.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures'
import { BadRequestError } from '@binance/common'
import ott from './ott.mjs'


let opBinaContractMarket = async(st, mode, tdid, uTrade, rTakeProfit, rStopLoss, opt = {}) => {

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
    let uTradeDef = get(st, 'uTrade', '')
    let quantityLow = get(st, 'quantityLow', '')
    let digPrice = get(st, 'digPrice', '')
    let digContractQuantity = get(st, 'digContractQuantity', '')
    // console.log('API_KEY', API_KEY)
    // console.log('API_SECRET', API_SECRET)
    // console.log('SYMBOL', SYMBOL)
    // console.log('uTradeDef', uTradeDef)
    // console.log('quantityLow', quantityLow)
    // console.log('digPrice', digPrice)
    // console.log('digContractQuantity', digContractQuantity)

    //check mode
    if (mode !== 'long' && mode !== 'short') {
        throw new Error(`invalid mode[${mode}]`)
    }

    //check tdid
    if (!isestr(tdid)) {
        throw new Error(`invalid tdid[${tdid}]`)
    }

    //check uTrade
    if (!isnum(uTrade)) {
        throw new Error(`invalid uTrade[${uTrade}]`)
    }
    uTrade = cdbl(uTrade)
    if (uTrade < cdbl(uTradeDef)) {
        throw new Error(`uTrade[${uTrade}] < uTradeDef[${uTradeDef}]`)
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

    //setLever
    let setLever = get(opt, 'setLever', false)

    //setCrossMargin
    let setCrossMargin = get(opt, 'setCrossMargin', false)

    //setDualSide
    let setDualSide = get(opt, 'setDualSide', false)

    //client
    let configurationRestAPI = {
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        basePath,
    }
    let client = new DerivativesTradingUsdsFutures({ configurationRestAPI })

    // console.log('keys(client.restAPI)', keys(client.restAPI))
    // keys(client.restAPI) [
    //   'configuration',
    //   'accountApi', //找不到此方法
    //   'convertApi',
    //   'marketDataApi',
    //   'portfolioMarginEndpointsApi',
    //   'tradeApi',
    //   'userDataStreamsApi'
    // ]

    //cgL, 槓桿改為1x
    if (setLever) {
        try {
            let cgLg = await client.restAPI.changeInitialLeverage({
                symbol: SYMBOL,
                leverage: 1,
            })
            await cgLg.data()
            // let cgL = await cgLg.data()
            // console.log('cgL', cgL)
            // cgL { symbol: 'ETHUSDT', leverage: 1, maxNotionalValue: '300000000' }
        }
        catch (err) {
            if (err instanceof BadRequestError && err.message?.includes('No need to change')) {
                // 槓桿已設定為目標值, 可安全忽略
            }
            else {
                throw err
            }
        }
    }

    //chM, 使用全倉
    if (setCrossMargin) {
        try {
            let chMt = await client.restAPI.changeMarginType({
                symbol: SYMBOL,
                marginType: 'CROSSED', //使用全倉保證金
            })
            await chMt.data()
            // let chM = await chMt.data()
            // console.log('chM', chM)
        }
        catch (err) {
            if (err instanceof BadRequestError && err.message?.includes('No need to change')) {
                // 已是 CROSSED, 可安全忽略
            }
            else {
                throw err
            }
        }
    }

    //chPt
    if (setDualSide) {
        try {
            let chPt = await client.restAPI.changePositionMode({
                dualSidePosition: true, //同時存在多空倉位(Hedge mode)
            })
            await chPt.data()
            // let chP = await chPt.data()
            // console.log('chP', chP)
        }
        catch (err) {
            if (err instanceof BadRequestError && err.message?.includes('No need to change')) {
                // 已是 hedge mode, 可安全忽略
            }
            else {
                throw err
            }
        }
    }

    //mkp
    let mkpr = await client.restAPI.markPrice({ symbol: SYMBOL })
    let mkp = await mkpr.data()
    // console.log('mkp', mkp)
    // mkp {
    //   symbol: 'ETHUSDT',
    //   markPrice: '3036.72000000',
    //   indexPrice: '3038.14441860',
    //   estimatedSettlePrice: '3036.44400385',
    //   lastFundingRate: '0.00010000',
    //   interestRate: '0.00010000',
    //   nextFundingTime: 1765036800000,
    //   time: 1765021406000
    // }

    //price
    let price = get(mkp, 'markPrice', '')
    if (!isnum(price)) {
        throw new Error(`invalid price for ${SYMBOL}`)
    }

    //idir
    let idir = 1
    if (mode === 'short') {
        idir = -1
    }

    //sideIn, sideOut
    let sideIn = 'BUY'
    let sideOut = 'SELL'
    if (mode === 'short') {
        sideIn = 'SELL'
        sideOut = 'BUY'
    }

    //pos
    let pos = 'LONG'
    if (mode === 'short') {
        pos = 'SHORT'
    }

    //priceTakeProfit
    let priceTakeProfit = (1 + idir * rTakeProfit) * cdbl(price) //下單設定止盈價格(USDT)
    priceTakeProfit = dig(priceTakeProfit, digPrice)
    // console.log('priceTakeProfit', priceTakeProfit)

    //priceStopLoss
    let priceStopLoss = (1 - idir * rStopLoss) * cdbl(price) //下單設定止損價格(USDT)
    priceStopLoss = dig(priceStopLoss, digPrice)
    // console.log('priceStopLoss', priceStopLoss)

    //quantity
    //須用10**x次方而非10^x: JS的^是XOR會把quantity數量級錯位(例:0.009變3顆), 下一行dig只截位數救不了
    let quantity = uTrade / cdbl(price)
    quantity = Math.floor(quantity * (10 ** digContractQuantity)) / (10 ** digContractQuantity)
    quantity = dig(quantity, digContractQuantity)
    // console.log('quantity', quantity)

    //check
    if (cdbl(quantity) < cdbl(quantityLow)) {
        throw new Error(`quantity[${quantity}] < quantityLow[${quantityLow}]`)
    }

    //uCost
    let uCost = cdbl(price) * cdbl(quantity)
    uCost = dig(uCost, 2)
    // console.log('uCost', uCost)

    //市價做多或空
    let resEntry = null
    let resTp = null
    let resSl = null
    try {

        //做多或空
        let rfEntry = await client.restAPI.newOrder({
            symbol: SYMBOL,
            side: sideIn,
            positionSide: pos,
            type: 'MARKET',
            quantity,
            newClientOrderId: `${tdid}_ENTRY`,
        })
        resEntry = await rfEntry.data()
        // console.log('resEntry', resEntry)
        // resEntry {
        //   orderId: 7605753097,
        //   symbol: 'ETHUSDT',
        //   status: 'NEW',
        //   clientOrderId: 'tdid-20251207205039-YbL7MN_ENTRY',
        //   price: '0.00',
        //   avgPrice: '0.00',
        //   origQty: '0.007',
        //   executedQty: '0.000',
        //   cumQty: '0.000',
        //   cumQuote: '0.00000',
        //   timeInForce: 'GTC',
        //   type: 'MARKET',
        //   reduceOnly: false,
        //   closePosition: false,
        //   side: 'BUY',
        //   positionSide: 'LONG',
        //   stopPrice: '0.00',
        //   workingType: 'CONTRACT_PRICE',
        //   priceProtect: false,
        //   origType: 'MARKET',
        //   priceMatch: 'NONE',
        //   selfTradePreventionMode: 'EXPIRE_MAKER',
        //   goodTillDate: 0,
        //   updateTime: 1765111842005
        // }

        //幣安帶單有下單速率限制20筆/10s, 每單至少500ms
        await delay(600)

        //止損
        //2025-12-09起Binance將條件單(STOP_MARKET/TAKE_PROFIT_MARKET等)強制走algoOrder, 否則回-4120
        //clientAlgoId限制 ^[\.A-Z\:/a-z0-9_-]{1,36}$, 目前tdid+'_SL'約29字接近上限
        let clientAlgoIdSl = `${tdid}_SL`
        if (clientAlgoIdSl.length > 36) {
            throw new Error(`clientAlgoIdSl length ${clientAlgoIdSl.length} > 36`)
        }
        let rfSl = await client.restAPI.newAlgoOrder({
            algoType: 'CONDITIONAL',
            symbol: SYMBOL,
            side: sideOut,
            positionSide: pos,
            type: 'STOP_MARKET',
            triggerPrice: priceStopLoss, //原stopPrice
            quantity,
            // reduceOnly: true, //dualSidePosition=true不能給reduceOnly=true
            workingType: 'MARK_PRICE',
            clientAlgoId: clientAlgoIdSl, //原newClientOrderId
        })
        resSl = await rfSl.data()
        // console.log('resSl', resSl)
        // resSl {
        //   orderId: 7605753102,
        //   symbol: 'ETHUSDT',
        //   status: 'NEW',
        //   clientOrderId: 'tdid-20251207205039-YbL7MN_SL',
        //   price: '0.00',
        //   avgPrice: '0.00',
        //   origQty: '0.007',
        //   executedQty: '0.000',
        //   cumQty: '0.000',
        //   cumQuote: '0.00000',
        //   timeInForce: 'GTC',
        //   type: 'STOP_MARKET',
        //   reduceOnly: true,
        //   closePosition: false,
        //   side: 'SELL',
        //   positionSide: 'LONG',
        //   stopPrice: '3041.23',
        //   workingType: 'MARK_PRICE',
        //   priceProtect: false,
        //   origType: 'STOP_MARKET',
        //   priceMatch: 'NONE',
        //   selfTradePreventionMode: 'EXPIRE_MAKER',
        //   goodTillDate: 0,
        //   updateTime: 1765111842723
        // }

        //幣安帶單有下單速率限制20筆/10s, 每單至少500ms
        await delay(600)

        //止盈
        //2025-12-09起Binance將條件單(STOP_MARKET/TAKE_PROFIT_MARKET等)強制走algoOrder, 否則回-4120
        //clientAlgoId限制 ^[\.A-Z\:/a-z0-9_-]{1,36}$, 目前tdid+'_TP'約29字接近上限
        let clientAlgoIdTp = `${tdid}_TP`
        if (clientAlgoIdTp.length > 36) {
            throw new Error(`clientAlgoIdTp length ${clientAlgoIdTp.length} > 36`)
        }
        let rfTp = await client.restAPI.newAlgoOrder({
            algoType: 'CONDITIONAL',
            symbol: SYMBOL,
            side: sideOut,
            positionSide: pos,
            type: 'TAKE_PROFIT_MARKET',
            triggerPrice: priceTakeProfit, //原stopPrice
            quantity,
            // reduceOnly: true, //dualSidePosition=true不能給reduceOnly=true
            workingType: 'MARK_PRICE',
            clientAlgoId: clientAlgoIdTp, //原newClientOrderId
        })
        resTp = await rfTp.data()
        // console.log('resTp', resTp)
        // resTp {
        //   orderId: 7605753100,
        //   symbol: 'ETHUSDT',
        //   status: 'NEW',
        //   clientOrderId: 'tdid-20251207205039-YbL7MN_TP',
        //   price: '0.00',
        //   avgPrice: '0.00',
        //   origQty: '0.007',
        //   executedQty: '0.000',
        //   cumQty: '0.000',
        //   cumQuote: '0.00000',
        //   timeInForce: 'GTC',
        //   type: 'TAKE_PROFIT_MARKET',
        //   reduceOnly: true,
        //   closePosition: false,
        //   side: 'SELL',
        //   positionSide: 'LONG',
        //   stopPrice: '3059.51',
        //   workingType: 'MARK_PRICE',
        //   priceProtect: false,
        //   origType: 'TAKE_PROFIT_MARKET',
        //   priceMatch: 'NONE',
        //   selfTradePreventionMode: 'EXPIRE_MAKER',
        //   goodTillDate: 0,
        //   updateTime: 1765111842380
        // }

        //幣安帶單有下單速率限制20筆/10s, 每單至少500ms
        await delay(600)

    }
    catch (err) {
        //部分狀態掛到err, 供呼叫端區分失敗發生於哪個階段(entry/TP/SL)
        err.resEntry = resEntry
        err.resTp = resTp
        err.resSl = resSl
        console.log(err)
        throw err
    }

    //SDK將大於Number.MAX_SAFE_INTEGER的整數parse為bigint, cint(BigInt)===0會把ID歸零, 故統一cstr()持有
    let idEntry = get(resEntry, 'orderId', null)
    if (idEntry === null || idEntry === undefined || idEntry === '') {
        throw new Error(`invalid resEntry.orderId`)
    }
    idEntry = cstr(idEntry)

    //algo單回應欄位是algoId / clientAlgoId, 不是orderId / clientOrderId
    let idTp = get(resTp, 'algoId', null)
    if (idTp === null || idTp === undefined || idTp === '') {
        throw new Error(`invalid resTp.algoId`)
    }
    idTp = cstr(idTp)

    let idSl = get(resSl, 'algoId', null)
    if (idSl === null || idSl === undefined || idSl === '') {
        throw new Error(`invalid resSl.algoId`)
    }
    idSl = cstr(idSl)

    let clientOrderIdEntry = get(resEntry, 'clientOrderId', '')
    if (!isestr(clientOrderIdEntry)) {
        throw new Error(`invalid resEntry.clientOrderId`)
    }

    let clientOrderIdTp = get(resTp, 'clientAlgoId', '')
    if (!isestr(clientOrderIdTp)) {
        throw new Error(`invalid resTp.clientAlgoId`)
    }

    let clientOrderIdSl = get(resSl, 'clientAlgoId', '')
    if (!isestr(clientOrderIdSl)) {
        throw new Error(`invalid resSl.clientAlgoId`)
    }

    //time
    let transactionTime = get(resEntry, 'updateTime', '')
    let time = ott(transactionTime).format('YYYY-MM-DDTHH:mm:ss')

    //symbol
    let symbol = SYMBOL

    //r
    let r = {

        mode,

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

        idTrade: tdid,
        idEntry,
        idTp, //實際是algoId(已String化), 保留欄位名供下游零改動
        idSl, //實際是algoId(已String化), 保留欄位名供下游零改動

        clientOrderIdEntry,
        clientOrderIdTp, //實際是clientAlgoId, 保留欄位名供下游零改動
        clientOrderIdSl, //實際是clientAlgoId, 保留欄位名供下游零改動

        //algo專用語意欄位, 取消時依此判斷走普通還是algo路徑
        isAlgoTp: true,
        isAlgoSl: true,
        algoIdTp: idTp,
        algoIdSl: idSl,
        clientAlgoIdTp: clientOrderIdTp,
        clientAlgoIdSl: clientOrderIdSl,

        resEntry,
        resTp,
        resSl,

    }

    return r
}


export default opBinaContractMarket
