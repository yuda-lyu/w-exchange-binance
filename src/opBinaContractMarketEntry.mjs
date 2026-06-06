import get from 'lodash-es/get.js'
import cdbl from 'wsemi/src/cdbl.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures'


//下純市價單 (newOrder wrapper). 不含 TP/SL ─ 若要 entry+TP+SL 一包, 用 opBinaContractMarket.
//典型用途: 反向市價平倉、單純市價進出 (不需條件單時).
//輸入: SYMBOL, side ('BUY'|'SELL'), positionSide ('LONG'|'SHORT'|'BOTH'), qty (數量), opt={}
let opBinaContractMarketEntry = async(st, SYMBOL, side, positionSide, qty, opt = {}) => {

    //check
    if (!isestr(SYMBOL)) {
        throw new Error(`invalid SYMBOL[${SYMBOL}]`)
    }
    if (side !== 'BUY' && side !== 'SELL') {
        throw new Error(`invalid side[${side}], 須為 BUY 或 SELL`)
    }
    if (positionSide !== 'LONG' && positionSide !== 'SHORT' && positionSide !== 'BOTH') {
        throw new Error(`invalid positionSide[${positionSide}], 須為 LONG/SHORT/BOTH`)
    }
    if (!isnum(qty) || cdbl(qty) <= 0) {
        throw new Error(`invalid qty[${qty}], 須為 > 0 之數字`)
    }

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

    //client
    let configurationRestAPI = {
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        basePath,
    }
    let client = new DerivativesTradingUsdsFutures({ configurationRestAPI })

    //下市價單
    let opf = await client.restAPI.newOrder({
        symbol: SYMBOL,
        side,
        positionSide,
        type: 'MARKET',
        quantity: cdbl(qty),
    })
    let r = await opf.data()

    return r
}


export default opBinaContractMarketEntry
