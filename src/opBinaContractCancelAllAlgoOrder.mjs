import get from 'lodash-es/get.js'
import isbol from 'wsemi/src/isbol.mjs'
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures'


//撤該SYMBOL所有「algo單」(走 /fapi/v1/algoOrder 路徑, 即2025-12-09起 TP/SL 條件單必走的路).
//典型用途: 測試帳號重置、緊急全撤. 注意:不會撤普通單(MARKET/LIMIT/舊式條件單),請另呼叫 opBinaContractCancelAllOrder.
let opBinaContractCancelAllAlgoOrder = async(st, opt = {}) => {

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

    //撤所有algo單
    let opf = await client.restAPI.cancelAllAlgoOpenOrders({ symbol: SYMBOL })
    let r = await opf.data()

    return r
}


export default opBinaContractCancelAllAlgoOrder
