import get from 'lodash-es/get.js'
import last from 'lodash-es/last.js'
import size from 'lodash-es/size.js'
import sortBy from 'lodash-es/sortBy.js'
import cdbl from 'wsemi/src/cdbl.mjs'
import cstr from 'wsemi/src/cstr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import callBinaRead from './callBinaRead.mjs'
import { BinaOpError, shapeArr } from './classifyBinaErr.mjs'
import getBinaClient from './getBinaClient.mjs'


//查詢指定起訖時間內的實際成交明細(accountTradeList)
//Binance限制: 單次最多1000筆, 時間窗最長7天 → 自動切7天窗 + 窗內以時間續抓拉完整段
//輸入: timeStart/timeEnd ('YYYY-MM-DDTHH:mm:ss'), opt: forceTest, onTrace
//輸出: 正規化成交陣列, 依time升序
//  [{ id, orderId, time, timeStr, side, positionSide, price, qty, quoteQty,
//     commission, commissionAsset, realizedPnl, maker, buyer }]
//注意: accountTradeList「不含」clientOrderId, 要對回tdid須以orderId join opBinaContractListOrdersHistory
//讀取失敗拋BinaOpError(err.execState、err.binance.attempts)
let opBinaContractListTradesFilled = async(st, ott, timeStart, timeEnd, opt = {}) => {

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

    //逐7天窗抓取, 窗內若滿1000筆則由最後一筆time重疊續抓並以id去重(以time+1續抓, 滿頁且同毫秒尚有資料時會漏筆)
    let all = []
    let seen = new Set()
    let winStart = msStart
    while (winStart < msEnd) {
        let winEnd = Math.min(winStart + WIN, msEnd)

        let curStart = winStart
        while (curStart <= winEnd) {
            let arr = await callBinaRead(() => client.restAPI.accountTradeList({
                symbol: SYMBOL,
                startTime: curStart,
                endTime: winEnd,
                limit: LIMIT,
                recvWindow,
            }), { name: 'userTrades', shape: shapeArr, onTrace })
            if (size(arr) === 0) {
                break
            }
            let nNew = 0
            for (let t of arr) {
                let id = cstr(get(t, 'id', ''))
                if (isestr(id) && !seen.has(id)) {
                    seen.add(id)
                    all.push(t)
                    nNew++
                }
            }
            if (size(arr) < LIMIT) {
                break
            }
            //窗內未抓完, 滿頁仍無新資料者無法再推進, 拋錯不得靜默漏筆
            let lastTime = Number(get(last(arr), 'time', 0))
            if (nNew === 0 || !lastTime || lastTime < curStart) {
                throw new BinaOpError(`opBinaContractListTradesFilled failed: pagination stuck`, { execState: 'unknown', outcome: 'PAGINATION_STUCK' })
            }
            curStart = lastTime
        }

        winStart = winEnd
        if (winEnd >= msEnd) {
            break
        }
    }

    //正規化
    let trades = []
    for (let t of all) {
        let id = cstr(get(t, 'id', ''))
        let timeMs = Number(get(t, 'time', 0))
        trades.push({
            id,
            orderId: cstr(get(t, 'orderId', '')),
            time: timeMs,
            timeStr: timeMs ? ott(timeMs).format('YYYY-MM-DDTHH:mm:ss') : '',
            side: get(t, 'side', ''),
            positionSide: get(t, 'positionSide', ''),
            price: cdbl(get(t, 'price', 0)),
            qty: cdbl(get(t, 'qty', 0)),
            quoteQty: cdbl(get(t, 'quoteQty', 0)),
            commission: cdbl(get(t, 'commission', 0)),
            commissionAsset: cstr(get(t, 'commissionAsset', '')), //null與缺欄皆回空字串(lodash get之預設值只補undefined)
            realizedPnl: cdbl(get(t, 'realizedPnl', 0)),
            maker: get(t, 'maker', false),
            buyer: get(t, 'buyer', false),
        })
    }

    //依time升序
    trades = sortBy(trades, 'time')

    return trades
}


export default opBinaContractListTradesFilled
