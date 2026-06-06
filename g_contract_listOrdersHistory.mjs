import _ from 'lodash-es'
import w from 'wsemi'
import getSettings from './src/getSettings.mjs'
import webina from './src/WExchangeBinance.mjs'


//幣安合約已成交訂單查詢 (依起訖時間)

let st = getSettings()

//[tag:查詢區間] 起訖時間 ('YYYY-MM-DDTHH:mm:ss')
let timeStart = '2026-05-03T00:00:00'
let timeEnd = '2026-05-10T23:59:59'

let main = async() => {

    console.log('═'.repeat(70))
    console.log('  幣安合約已成交訂單查詢 (依起訖時間)')
    console.log('═'.repeat(70))
    console.log(`查詢區間: ${timeStart} ~ ${timeEnd}`)
    console.log('')

    //兩源並查
    let orders = await webina.opBinaContractListOrdersHistory(st, timeStart, timeEnd)
    let trades = await webina.opBinaContractListTradesFilled(st, timeStart, timeEnd)

    //── 區段A: 訂單層級歷史 (依tdid分組, 看entry/TP/SL狀態) ──
    console.log('─'.repeat(70))
    console.log(`  [A] 訂單歷史 (allOrders + queryAllAlgoOrders): 共 ${orders.length} 筆`)
    console.log('─'.repeat(70))
    let ordersByTdid = _.groupBy(orders, (o) => o.tdid || '(無tdid)')
    let tdids = _.keys(ordersByTdid).sort()
    for (let tdid of tdids) {
        let os = _.sortBy(ordersByTdid[tdid], 'time')
        console.log(`  ${tdid}`)
        for (let o of os) {
            let kindStr = (o.kind || '?').padEnd(5)
            let stat = (o.status || '-').padEnd(9)
            console.log(`    ${kindStr} | ${stat} | ${o.isAlgo ? 'algo' : 'norm'} | orderId=${o.orderId} | avgPrice=${o.avgPrice} | execQty=${o.executedQty} | ${o.timeStr}`)
        }
    }
    console.log('')

    //── 區段B: 實際成交明細 (accountTradeList, 含真實手續費) ──
    console.log('─'.repeat(70))
    console.log(`  [B] 實際成交明細 (accountTradeList): 共 ${trades.length} 筆`)
    console.log('─'.repeat(70))
    for (let t of trades) {
        console.log(`    ${t.timeStr} | ${t.side.padEnd(4)} | orderId=${t.orderId} | price=${t.price} | qty=${t.qty} | fee=${t.commission}${t.commissionAsset} | realizedPnl=${t.realizedPnl}`)
    }
    console.log('')

    //── 區段C: 依tdid配對算實際P&L (以orderId join 訂單→trade) ──
    //orderId → {tdid, kind} 對照表. 只認策略單(clientOrderId為 tdid-XXX_KIND);
    //非tdid-格式(如web_XXX手動單)不納入, 其trade會落到「無法對回tdid」桶
    let mapOrderId = {}
    for (let o of orders) {
        if (w.isestr(o.orderId) && String(o.clientOrderId).startsWith('tdid-')) {
            mapOrderId[o.orderId] = { tdid: o.tdid, kind: o.kind }
        }
    }

    //每筆trade對回tdid, 彙整
    let aggByTdid = {} //{ tdid: { realizedPnl, commission, n } }
    let unmatched = { realizedPnl: 0, commission: 0, n: 0 }
    for (let t of trades) {
        let m = mapOrderId[t.orderId]
        if (!m || !w.isestr(m.tdid)) {
            unmatched.realizedPnl += t.realizedPnl
            unmatched.commission += t.commission
            unmatched.n++
            continue
        }
        let tdid = m.tdid
        if (!aggByTdid[tdid]) {
            aggByTdid[tdid] = { realizedPnl: 0, commission: 0, n: 0 }
        }
        aggByTdid[tdid].realizedPnl += t.realizedPnl
        aggByTdid[tdid].commission += t.commission
        aggByTdid[tdid].n++
    }

    console.log('─'.repeat(70))
    console.log(`  [C] 依tdid實際損益 (realizedPnl - 手續費)`)
    console.log('─'.repeat(70))
    let aggTdids = _.keys(aggByTdid).sort()
    let totalNet = 0
    for (let tdid of aggTdids) {
        let a = aggByTdid[tdid]
        let net = a.realizedPnl - a.commission
        totalNet += net
        console.log(`    ${tdid} | 成交${a.n}筆 | realizedPnl=${w.dig(a.realizedPnl, 4)} | fee=${w.dig(a.commission, 4)} | 淨損益=${w.dig(net, 4)}`)
    }
    if (unmatched.n > 0) {
        let net = unmatched.realizedPnl - unmatched.commission
        totalNet += net
        console.log(`    (無法對回tdid) | 成交${unmatched.n}筆 | realizedPnl=${w.dig(unmatched.realizedPnl, 4)} | fee=${w.dig(unmatched.commission, 4)} | 淨損益=${w.dig(net, 4)}`)
    }
    console.log('')
    console.log(`  總淨損益 = ${w.dig(totalNet, 4)} USDT`)
    console.log('')

}
await main()
    .catch((err) => {
        console.log(err)
    })


//node g_contract_listOrdersHistory.mjs
