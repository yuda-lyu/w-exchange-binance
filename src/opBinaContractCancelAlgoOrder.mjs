import get from 'lodash-es/get.js'
import isbol from 'wsemi/src/isbol.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures'


let opBinaContractCancelAlgoOrder = async(st, algoId, opt = {}) => {

    //check
    if (!isestr(algoId) && !Number.isInteger(algoId)) {
        throw new Error(`algoId[${algoId}] is invalid`)
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
    // console.log('API_KEY', API_KEY)
    // console.log('API_SECRET', API_SECRET)

    //client
    let configurationRestAPI = {
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        basePath,
    }
    let client = new DerivativesTradingUsdsFutures({ configurationRestAPI })

    //clod
    //v22起欄位名為algoId(camelCase, 之前v19~v21是algoid全小寫)
    let clodr = await client.restAPI.cancelAlgoOrder({
        algoId: typeof algoId === 'string' ? algoId : Number(algoId),
    })
    let clod = await clodr.data()

    return clod
}


export default opBinaContractCancelAlgoOrder
