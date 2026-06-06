import get from 'lodash-es/get.js'
import isbol from 'wsemi/src/isbol.mjs'
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures'


let opBinaContractQueryAccountInfor = async(st, opt = {}) => {

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

    //acInfom
    let acInfom = await client.restAPI.accountInformationV3()
    let acInfo = await acInfom.data()
    // console.log('acInfo', acInfo)
    // acInfo {
    //   totalInitialMargin: '0.00000000',
    //   totalMaintMargin: '0.00000000',
    //   totalWalletBalance: '1003.27085983',
    //   totalUnrealizedProfit: '0.00000000',
    //   totalMarginBalance: '1003.27085983',
    //   totalPositionInitialMargin: '0.00000000',
    //   totalOpenOrderInitialMargin: '0.00000000',
    //   totalCrossWalletBalance: '1003.27085983',
    //   totalCrossUnPnl: '0.00000000',
    //   availableBalance: '1003.27085983',
    //   maxWithdrawAmount: '1003.27085983',
    //   assets:[...],
    //   positions: [...],
    // }

    let r = acInfo

    return r
}


export default opBinaContractQueryAccountInfor
