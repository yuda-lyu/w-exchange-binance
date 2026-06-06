import get from 'lodash-es/get.js'
import isbol from 'wsemi/src/isbol.mjs'
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures'


//撤該SYMBOL所有「普通單」(走 /fapi/v1/order 路徑、NEW狀態的非algo單).
//典型用途: 測試帳號重置、緊急全撤. 注意:不會撤algo單(TP/SL條件單),請另呼叫 opBinaContractCancelAllAlgoOrder.
let opBinaContractCancelAllOrder = async(st, opt = {}) => {

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

    //client
    let configurationRestAPI = {
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        basePath,
    }
    let client = new DerivativesTradingUsdsFutures({ configurationRestAPI })

    //撤所有普通單
    let opf = await client.restAPI.cancelAllOpenOrders({ symbol: SYMBOL })
    let r = await opf.data()

    return r
}


export default opBinaContractCancelAllOrder
