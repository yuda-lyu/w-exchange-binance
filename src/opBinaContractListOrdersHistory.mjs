import get from 'lodash-es/get.js'
import last from 'lodash-es/last.js'
import size from 'lodash-es/size.js'
import sortBy from 'lodash-es/sortBy.js'
import cdbl from 'wsemi/src/cdbl.mjs'
import cstr from 'wsemi/src/cstr.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import sep from 'wsemi/src/sep.mjs'
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures'
import ott from './ott.mjs'


//查詢指定起訖時間內的訂單層級歷史(allOrders普通單 + queryAllAlgoOrders algo單)
//Binance限制: 單次最多1000筆, 時間窗最長7天 → 自動切7天窗 + 窗內以時間續抓拉完整段
//輸入: timeStart/timeEnd ('YYYY-MM-DDTHH:mm:ss'), opt預留
//輸出: 正規化訂單陣列, 依time升序
//  [{ orderId, clientOrderId, tdid, kind, isAlgo, status, type, side, positionSide,
//     avgPrice, executedQty, origQty, time, timeStr, updateTime }]
//  普通單(entry)的clientOrderId為 tdid-XXX_ENTRY; algo單(TP/SL)的clientAlgoId為 tdid-XXX_TP / _SL
//  與accountTradeList以orderId對應(普通單orderId / algo單algoId)
let opBinaContractListOrdersHistory = async(st, timeStart, timeEnd, opt = {}) => {

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
    let configurationRestAPI = { apiKey: API_KEY, apiSecret: API_SECRET, basePath }
    let client = new DerivativesTradingUsdsFutures({ configurationRestAPI })

    //ms範圍
    let msStart = ott(timeStart).valueOf()
    let msEnd = ott(timeEnd).valueOf()
    if (!(msStart < msEnd)) {
        throw new Error(`timeStart[${timeStart}] 須早於 timeEnd[${timeEnd}]`)
    }

    let WIN = 7 * 24 * 60 * 60 * 1000 //7天(Binance時間窗上限)
    let LIMIT = 1000

    //通用: 逐7天窗 + 窗內續抓, fnFetch(curStart, winEnd) -> arr, fnTime(o) -> ms
    let fetchAllByWindow = async(fnFetch, fnTime) => {
        let all = []
        let winStart = msStart
        while (winStart < msEnd) {
            let winEnd = Math.min(winStart + WIN, msEnd)

            let curStart = winStart
            while (curStart <= winEnd) {
                let arr = await fnFetch(curStart, winEnd)
                if (size(arr) === 0) {
                    break
                }
                all.push(...arr)
                if (size(arr) < LIMIT) {
                    break
                }
                let lastTime = Number(fnTime(last(arr)))
                if (!lastTime || lastTime < curStart) {
                    break //防呆
                }
                curStart = lastTime + 1
            }

            winStart = winEnd
            if (winEnd >= msEnd) {
                break
            }
        }
        return all
    }

    //普通單(entry)
    let rawNormal = await fetchAllByWindow(
        async(curStart, winEnd) => {
            let op = await client.restAPI.allOrders({ symbol: SYMBOL, startTime: curStart, endTime: winEnd, limit: LIMIT })
            return await op.data()
        },
        (o) => get(o, 'time', 0),
    )

    //algo單(TP/SL). 注意algo單欄位名與普通單不同: algoId/clientAlgoId/algoStatus/orderType/createTime/actualPrice/quantity
    let rawAlgo = await fetchAllByWindow(
        async(curStart, winEnd) => {
            let op = await client.restAPI.queryAllAlgoOrders({ symbol: SYMBOL, startTime: curStart, endTime: winEnd, limit: LIMIT })
            return await op.data()
        },
        (o) => get(o, 'createTime', 0),
    )

    //正規化單筆 (普通單與algo單欄位名不同, 統一成同一份schema)
    let norm = (o, isAlgo) => {
        let clientOrderId = isAlgo ? get(o, 'clientAlgoId', '') : get(o, 'clientOrderId', '')
        let ss = sep(clientOrderId, '_')
        let tdid = get(ss, 0, '')
        let kind = get(ss, 1, '') //ENTRY / TP / SL
        let timeMs = Number(isAlgo ? get(o, 'createTime', 0) : get(o, 'time', 0))
        let updMs = Number(get(o, 'updateTime', 0))
        return {
            orderId: cstr(isAlgo ? get(o, 'algoId', '') : get(o, 'orderId', '')),
            clientOrderId,
            tdid,
            kind,
            isAlgo,
            actualOrderId: isAlgo ? cstr(get(o, 'actualOrderId', '')) : '', //algo觸發後產生的普通單orderId(未觸發為空)
            status: isAlgo ? get(o, 'algoStatus', '') : get(o, 'status', ''),
            type: isAlgo ? get(o, 'orderType', '') : get(o, 'type', get(o, 'origType', '')),
            side: get(o, 'side', ''),
            positionSide: get(o, 'positionSide', ''),
            avgPrice: cdbl(isAlgo ? get(o, 'actualPrice', 0) : get(o, 'avgPrice', 0)),
            executedQty: cdbl(get(o, 'executedQty', 0)),
            origQty: cdbl(isAlgo ? get(o, 'quantity', 0) : get(o, 'origQty', 0)),
            triggerPrice: cdbl(isAlgo ? get(o, 'triggerPrice', 0) : get(o, 'stopPrice', 0)),
            time: timeMs,
            timeStr: timeMs ? ott(timeMs).format('YYYY-MM-DDTHH:mm:ss') : '',
            updateTime: updMs,
        }
    }

    //去重 + 正規化
    let seen = new Set()
    let orders = []
    for (let o of rawNormal) {
        let key = `n_${cstr(get(o, 'orderId', ''))}`
        if (seen.has(key)) {
            continue
        }
        seen.add(key)
        orders.push(norm(o, false))
    }
    for (let o of rawAlgo) {
        let key = `a_${cstr(get(o, 'algoId', ''))}`
        if (seen.has(key)) {
            continue
        }
        seen.add(key)
        orders.push(norm(o, true))
    }

    //依time升序
    orders = sortBy(orders, 'time')

    return orders
}


export default opBinaContractListOrdersHistory
