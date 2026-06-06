import get from 'lodash-es/get.js'
import cint from 'wsemi/src/cint.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import isint from 'wsemi/src/isint.mjs'
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures'


let opBinaContractCancelOrder = async(st, orderId, opt = {}) => {

    //check
    if (!isint(orderId)) {
        throw new Error(`orderId[${orderId}] is not an integer`)
    }
    orderId = cint(orderId)

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

    //clod
    let clodr = await client.restAPI.cancelOrder({
        symbol: SYMBOL,
        orderId,
    })
    let clod = await clodr.data()
    // console.log('clod', clod)
    // clod {
    //   orderId: 7605276918,
    //   symbol: 'ETHUSDT',
    //   status: 'CANCELED',
    //   clientOrderId: 'tdid-20251206194325-Zqaa49_TP',
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
    //   positionSide: 'BOTH',
    //   stopPrice: '3048.87',
    //   workingType: 'MARK_PRICE',
    //   priceProtect: false,
    //   origType: 'TAKE_PROFIT_MARKET',
    //   priceMatch: 'NONE',
    //   selfTradePreventionMode: 'EXPIRE_MAKER',
    //   goodTillDate: 0,
    //   updateTime: 1765024172313
    // }

    return clod
}


export default opBinaContractCancelOrder
