import get from 'lodash-es/get.js'
import isbol from 'wsemi/src/isbol.mjs'
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures'


//依照下單id去Binance查詢實際成交資訊
//輸入: 訂單物件o, 須含 idEntry / idTp / idSl (即 d10_execute/orders/ JSON 內欄位)
//輸出: { tdid, idEntry, idTp, idSl, resEntry, resTp, resSl }
//resEntry 為普通單回應, resTp/resSl 為algo單回應
//任一筆查詢失敗則該欄改成 { error: '...' }, 整體不throw讓呼叫端能逐筆判斷
let opBinaContractQueryOrderInfo = async(st, o, opt = {}) => {

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

    //queryRegular: 查普通單(entry使用)
    let queryRegular = async(orderId) => {
        if (!orderId) {
            return null
        }
        try {
            let r = await client.restAPI.queryOrder({
                symbol: SYMBOL,
                orderId: typeof orderId === 'string' ? orderId : Number(orderId),
            })
            return await r.data()
        }
        catch (err) {
            return { error: String(err) }
        }
    }

    //queryAlgo: 查algo單(TP/SL使用)
    let queryAlgo = async(algoId) => {
        if (!algoId) {
            return null
        }
        try {
            let r = await client.restAPI.queryAlgoOrder({
                algoId: typeof algoId === 'string' ? algoId : Number(algoId),
            })
            return await r.data()
        }
        catch (err) {
            return { error: String(err) }
        }
    }

    //依序查3筆(序列避免撞rate limit)
    let resEntry = await queryRegular(o.idEntry)
    let resTp = await queryAlgo(o.idTp)
    let resSl = await queryAlgo(o.idSl)

    //r
    let r = {
        tdid: o.tdid,
        idEntry: o.idEntry,
        idTp: o.idTp,
        idSl: o.idSl,
        resEntry,
        resTp,
        resSl,
    }
    // console.log('r', r)
    // r {
    //   tdid: 'tdid-20251207205039-YbL7MN',
    //   idEntry: '7605753097',
    //   idTp: '7605753100',
    //   idSl: '7605753102',
    //   resEntry: {
    //     orderId: 7605753097,
    //     symbol: 'ETHUSDT',
    //     status: 'FILLED',          //'NEW' / 'FILLED' / 'CANCELED' / 'EXPIRED' ...
    //     clientOrderId: 'tdid-20251207205039-YbL7MN_ENTRY',
    //     avgPrice: '3047.32',       //實際成交均價
    //     executedQty: '0.007',      //實際成交數量
    //     cumQuote: '21.331',        //名義成交金額(USDT)
    //     ...
    //   },
    //   resTp: {
    //     algoId: 7605753100,
    //     symbol: 'ETHUSDT',
    //     status: 'NEW',             //'NEW' / 'FILLED' / 'CANCELED' / 'TRIGGERED' / 'EXPIRED'
    //     clientAlgoId: 'tdid-20251207205039-YbL7MN_TP',
    //     stopPrice: '3059.51',
    //     avgPrice: '0',             //觸發後才有值
    //     executedQty: '0',
    //     ...
    //   },
    //   resSl: { ... 同上結構 }
    // }

    return r
}


export default opBinaContractQueryOrderInfo
