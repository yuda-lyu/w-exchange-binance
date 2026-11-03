import get from 'lodash-es/get.js'
import last from 'lodash-es/last.js'
import size from 'lodash-es/size.js'
import sortBy from 'lodash-es/sortBy.js'
import cdbl from 'wsemi/src/cdbl.mjs'
import cstr from 'wsemi/src/cstr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import callBinaRead from './callBinaRead.mjs'
import { BinaOpError, shapeArr } from './classifyBinaErr.mjs'
import getBinaClient from './getBinaClient.mjs'


//依字尾解析: tdid可能含底線者, 以第一個底線切分會解析錯
let parseClientId = (clientOrderId) => {
    let m = /^(.+)_(ENTRY|TP|SL)$/.exec(clientOrderId)
    if (m) {
        return { tdid: m[1], kind: m[2] }
    }
    return { tdid: '', kind: '' }
}


//查詢指定起訖時間內的訂單層級歷史(allOrders普通單 + queryAllAlgoOrders algo單)
//Binance限制: 單次最多1000筆, 時間窗最長7天 → 自動切7天窗 + 窗內以時間續抓拉完整段
//輸入: timeStart/timeEnd ('YYYY-MM-DDTHH:mm:ss'), opt: forceTest, onTrace
//輸出: 正規化訂單陣列, 依time升序
//  [{ orderId, clientOrderId, tdid, kind, isAlgo, status, type, side, positionSide,
//     avgPrice, executedQty, origQty, time, timeStr, updateTime }]
//  普通單(entry)的clientOrderId為 tdid-XXX_ENTRY; algo單(TP/SL)的clientAlgoId為 tdid-XXX_TP / _SL
//  與accountTradeList以orderId對應(普通單orderId / algo單algoId)
//  讀取失敗拋BinaOpError(err.execState、err.binance.attempts)
let opBinaContractListOrdersHistory = async(st, ott, timeStart, timeEnd, opt = {}) => {

    //check
    if (!isfun(ott)) {
        throw new Error(`invalid ott: must be a function`)
    }

    //client
    let { client, SYMBOL, recvWindow } = getBinaClient(st, opt)
    let onTrace = get(opt, 'onTrace', null)

    //ms範圍
    let msStart = ott(timeStart).valueOf()
    let msEnd = ott(timeEnd).valueOf()
    if (!(msStart < msEnd)) {
        throw new Error(`invalid timeStart: must be earlier than timeEnd`)
    }

    let WIN = 7 * 24 * 60 * 60 * 1000 //7天(Binance時間窗上限)
    let LIMIT = 1000

    //通用: 逐7天窗 + 窗內續抓, fnFetch(curStart, winEnd) -> arr, fnTime(o) -> ms, fnKey(o) -> 去重鍵
    //滿頁且同毫秒尚有資料時以time+1續抓會漏筆, 故由最後一筆time重疊續抓並以ID去重; 滿頁仍無新資料者無法再推進, 拋錯不得靜默漏筆
    let fetchAllByWindow = async(fnFetch, fnTime, fnKey) => {
        let all = []
        let seenKey = new Set()
        let winStart = msStart
        while (winStart < msEnd) {
            let winEnd = Math.min(winStart + WIN, msEnd)

            let curStart = winStart
            while (curStart <= winEnd) {
                let arr = await fnFetch(curStart, winEnd)
                if (size(arr) === 0) {
                    break
                }
                let nNew = 0
                for (let o of arr) {
                    let key = fnKey(o)
                    if (!seenKey.has(key)) {
                        seenKey.add(key)
                        all.push(o)
                        nNew++
                    }
                }
                if (size(arr) < LIMIT) {
                    break
                }
                let lastTime = Number(fnTime(last(arr)))
                if (nNew === 0 || !lastTime || lastTime < curStart) {
                    throw new BinaOpError(`opBinaContractListOrdersHistory failed: pagination stuck`, { execState: 'unknown', outcome: 'PAGINATION_STUCK' })
                }
                curStart = lastTime
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
            return callBinaRead(() => client.restAPI.allOrders({ symbol: SYMBOL, startTime: curStart, endTime: winEnd, limit: LIMIT, recvWindow }), { name: 'allOrders', shape: shapeArr, onTrace })
        },
        (o) => get(o, 'time', 0),
        (o) => cstr(get(o, 'orderId', '')),
    )

    //algo單(TP/SL). 注意algo單欄位名與普通單不同: algoId/clientAlgoId/algoStatus/orderType/createTime/actualPrice/quantity
    let rawAlgo = await fetchAllByWindow(
        async(curStart, winEnd) => {
            return callBinaRead(() => client.restAPI.queryAllAlgoOrders({ symbol: SYMBOL, startTime: curStart, endTime: winEnd, limit: LIMIT, recvWindow }), { name: 'allAlgoOrders', shape: shapeArr, onTrace })
        },
        (o) => get(o, 'createTime', 0),
        (o) => cstr(get(o, 'algoId', '')),
    )

    //正規化單筆 (普通單與algo單欄位名不同, 統一成同一份schema)
    let norm = (o, isAlgo) => {
        let clientOrderId = isAlgo ? get(o, 'clientAlgoId', '') : get(o, 'clientOrderId', '')
        let { tdid, kind } = parseClientId(clientOrderId) //kind: ENTRY / TP / SL
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
            executedQty: cdbl(isAlgo ? get(o, 'actualQty', 0) : get(o, 'executedQty', 0)), //allAlgoOrders無executedQty, 成交量在actualQty
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
