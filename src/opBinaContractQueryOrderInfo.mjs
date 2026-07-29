import find from 'lodash-es/find.js'
import get from 'lodash-es/get.js'
import cstr from 'wsemi/src/cstr.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import isestr from 'wsemi/src/isestr.mjs'
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
                orderId: isestr(orderId) ? orderId : Number(orderId),
            })
            return await r.data()
        }
        catch (err) {
            return { error: String(err) }
        }
    }

    //queryAlgo: 查algo單(TP/SL使用)
    //CONDITIONAL TP/SL 無可用單筆查詢端點(queryAlgoOrder 一律回 'Order does not exist');
    //且 queryAllAlgoOrders(歷史端點)對「剛下、仍開啟」的單有最終一致性延遲(實測下單後數百ms即查不到),
    //故先查 currentAllAlgoOpenOrders(對開啟中的單即時可靠), 再以 queryAllAlgoOrders 補已觸發/已撤/已成交的歷史單.
    let queryAlgo = async(algoId) => {
        if (!algoId) {
            return null
        }
        try {

            //1) 開啟中(對剛下的單即時可靠)
            let ro = await client.restAPI.currentAllAlgoOpenOrders({ symbol: SYMBOL })
            let open = await ro.data()
            let hitOpen = find(open, (o) => cstr(o.algoId) === cstr(algoId))
            if (hitOpen) {
                return hitOpen
            }

            //2) 已觸發/已撤/已成交 → 查歷史(供結算判斷成交)
            let rh = await client.restAPI.queryAllAlgoOrders({
                symbol: SYMBOL,
                algoId: isestr(algoId) ? Number(algoId) : algoId,
            })
            let hist = await rh.data()
            let hitHist = find(hist, (o) => cstr(o.algoId) === cstr(algoId))
            if (hitHist) {
                return hitHist
            }

            return { error: 'Order does not exist.' }
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
    //   tdid: 'tdid-20260729213334-cB7pjm',
    //   idEntry: '14925106909',
    //   idTp: '1000000149617643',
    //   idSl: '1000000149617632',
    //   resEntry: {
    //     orderId: 14925106909,
    //     symbol: 'ETHUSDT',
    //     status: 'FILLED',          //'NEW' / 'FILLED' / 'CANCELED' / 'EXPIRED' ...
    //     clientOrderId: 'tdid-20260729213334-cB7pjm_ENTRY',
    //     avgPrice: '1908.17000',    //實際成交均價
    //     executedQty: '0.011',      //實際成交數量
    //     cumQuote: '20.98987',      //名義成交金額(USDT)
    //     ...
    //   },
    //   resTp: {
    //     algoId: 1000000149617643,
    //     symbol: 'ETHUSDT',
    //     algoStatus: 'NEW',         //'NEW' / 'FILLED' / 'CANCELED' / 'TRIGGERED' / 'EXPIRED'
    //     clientAlgoId: 'tdid-20260729213334-cB7pjm_TP',
    //     triggerPrice: '2060.54',
    //     actualQty: '0.0',          //觸發後才有值
    //     actualOrderId: '',         //觸發後產生的普通單orderId(未觸發為空)
    //     ...
    //   },
    //   resSl: { ... 同上結構 }
    // }

    return r
}


export default opBinaContractQueryOrderInfo
