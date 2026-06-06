import get from 'lodash-es/get.js'
import isbol from 'wsemi/src/isbol.mjs'
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures'


//查 settings.symbol 的持倉詳細資料 (走 /fapi/v3/positionRisk = positionInformationV3).
//回傳陣列: hedge mode 每個 positionSide (LONG/SHORT) 一筆; one-way mode 只一筆 (BOTH).
//欄位含 entryPrice/breakEvenPrice/markPrice/unRealizedProfit/liquidationPrice/notional/positionAmt/positionSide 等.
//比 accountInformationV3.positions 更詳細(多 entryPrice/markPrice/liquidationPrice 等).
let opBinaContractQueryPositionInfor = async(st, opt = {}) => {

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

    //持倉
    let opf = await client.restAPI.positionInformationV3({ symbol: SYMBOL })
    let r = await opf.data()

    return r
}


export default opBinaContractQueryPositionInfor
