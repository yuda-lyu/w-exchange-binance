import get from 'lodash-es/get.js'
import last from 'lodash-es/last.js'
import size from 'lodash-es/size.js'
import sortBy from 'lodash-es/sortBy.js'
import cdbl from 'wsemi/src/cdbl.mjs'
import cstr from 'wsemi/src/cstr.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures'
import ott from './ott.mjs'


//查詢指定起訖時間內的實際成交明細(accountTradeList)
//Binance限制: 單次最多1000筆, 時間窗最長7天 → 自動切7天窗 + 窗內以時間續抓拉完整段
//輸入: timeStart/timeEnd ('YYYY-MM-DDTHH:mm:ss'), opt預留
//輸出: 正規化成交陣列, 依time升序
//  [{ id, orderId, time, timeStr, side, positionSide, price, qty, quoteQty,
//     commission, commissionAsset, realizedPnl, maker, buyer }]
//注意: accountTradeList「不含」clientOrderId, 要對回tdid須以orderId join opBinaContractListOrdersHistory
let opBinaContractListTradesFilled = async(st, timeStart, timeEnd, opt = {}) => {

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

    //逐7天窗抓取, 窗內若滿1000筆則以「最後一筆time+1」續抓
    let all = []
    let winStart = msStart
    while (winStart < msEnd) {
        let winEnd = Math.min(winStart + WIN, msEnd)

        let curStart = winStart
        while (curStart <= winEnd) {
            let op = await client.restAPI.accountTradeList({
                symbol: SYMBOL,
                startTime: curStart,
                endTime: winEnd,
                limit: LIMIT,
            })
            let arr = await op.data()
            if (size(arr) === 0) {
                break
            }
            all.push(...arr)
            if (size(arr) < LIMIT) {
                break
            }
            //窗內未抓完, 從最後一筆time+1續抓
            let lastTime = Number(get(last(arr), 'time', 0))
            if (!lastTime || lastTime < curStart) {
                break //防呆, 避免無限迴圈
            }
            curStart = lastTime + 1
        }

        winStart = winEnd //邊界ms重疊由下方id去重處理
        if (winEnd >= msEnd) {
            break
        }
    }

    //去重(切窗/續抓可能重疊) by id + 正規化
    let seen = new Set()
    let trades = []
    for (let t of all) {
        let id = cstr(get(t, 'id', ''))
        if (!isestr(id) || seen.has(id)) {
            continue
        }
        seen.add(id)
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
            commissionAsset: get(t, 'commissionAsset', ''),
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
