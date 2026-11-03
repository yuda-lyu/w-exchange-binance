import assert from 'assert'
import ott from '../src/ott.mjs'
import webina from '../src/WExchangeBinance.mjs'
import { blocked, mkFake, r1021, startFake, stopFake } from './tools/binaFakeServer.mjs'


//站點×結果矩陣(bx297 §3、§7.1 之參數化保留): 全部HTTP站點(含回查、保護單排除、取消內部讀取)逐一套用各種伺服器結果, 斷言不變式
//不變式來自§5.2: 錯誤一律帶execState與binance或outcome; 進場POST每呼叫至多1次; 伺服器已執行而呼叫端不得得到未執行; 未確認成交不掛保護; 無舊時間戳重送; 不連外
describe('站點×結果矩陣 (本機假伺服器)', function() {
    this.timeout(1800000)

    let opt = { forceTest: true }
    let T0 = '2026-11-01T00:00:00'
    let T1 = '2026-11-02T00:00:00'
    let nTdid = 0
    let tdid = () => `tdid-x-${++nTdid}`

    let isSl = (p) => p.get('type') === 'STOP_MARKET'
    let isTp = (p) => p.get('type') === 'TAKE_PROFIT_MARKET'

    let market = (st) => webina.opBinaContractMarket(st, ott, 'long', tdid(), 22, 0.04, 0.02, { ...opt, setLever: true, setCrossMargin: true, setDualSide: true })
    let marketEntry = (st) => webina.opBinaContractMarketEntry(st, 'ETHUSDT', 'SELL', 'LONG', 0.007, opt)
    let marketEntryId = (st) => webina.opBinaContractMarketEntry(st, 'ETHUSDT', 'SELL', 'LONG', 0.007, { ...opt, clientOrderId: tdid() })
    let place = (st) => webina.opBinaContractPlaceProtection(st, tdid(), 'long', '0.007', 2900, 3100, opt)
    let queryInfo = (st) => webina.opBinaContractQueryOrderInfo(st, { tdid: 'tdid-x', idEntry: '111', idTp: '333', idSl: '222' }, opt)
    let residual = (st) => webina.opBinaContractCancelResidualOrders(st, opt)
    let cancelOrder = (st) => webina.opBinaContractCancelOrder(st, '111', opt)
    let cancelAlgo = (st) => webina.opBinaContractCancelAlgoOrder(st, '222', opt)
    let cancelAll = (st) => webina.opBinaContractCancelAllOrder(st, opt)

    let seedResidual = (fx) => {
        fx.ex.addAlgo({ clientAlgoId: 'tdid-a_TP', orderType: 'TAKE_PROFIT_MARKET', createTime: Date.now() - 60000 })
        fx.ex.addOrder({ clientOrderId: 'tdid-b_SL', status: 'NEW', executedQty: '0', type: 'STOP_MARKET', time: Date.now() - 60000 })
    }
    let seedCancel = (fx) => {
        fx.ex.addOrder({ orderId: 111, clientOrderId: 'c1', status: 'NEW', executedQty: '0' })
        fx.ex.addAlgo({ algoId: 222, clientAlgoId: 'a1' })
    }
    let seedPosition = (fx) => {
        fx.ex.positions.LONG = 0.007
    }
    let seedPartner = (fx) => {
        fx.ex.positions.LONG = 0.007
        fx.ex.addAlgo({ clientAlgoId: 'tdid-p_SL', orderType: 'STOP_MARKET', createTime: Date.now() - 60000 })
    }

    let baseEntryExec = (fx) => fx.on('POST /fapi/v1/order', [{ exec: true, reply: 'reset' }])
    let baseEntryNo = (fx) => fx.on('POST /fapi/v1/order', [{ exec: false, reply: 'reset' }])
    let baseSl = (fx) => fx.on('POST /fapi/v1/algoOrder', isSl, [{ exec: false, reply: 'reset' }])
    let baseDel = (key) => (fx) => fx.on(key, [{ exec: false, reply: 'reset' }])
    let baseDel2011 = (key) => (fx) => fx.on(key, [{ exec: false, reply: { status: 400, body: { code: -2011, msg: 'x' } } }])

    //wr: 寫入站之種類, 用於「已執行不得回未執行」; prefix: 前幾個同key請求放行, 故障才落到目標站
    let sites = [
        { id: 'Market.gate', w: 'GET', key: 'GET /fapi/v1/order', op: market },
        { id: 'Market.leverage', w: 'POST', key: 'POST /fapi/v1/leverage', op: market },
        { id: 'Market.marginType', w: 'POST', key: 'POST /fapi/v1/marginType', op: market },
        { id: 'Market.positionMode', w: 'POST', key: 'POST /fapi/v1/positionSide/dual', op: market },
        { id: 'Market.markPrice', w: 'GET', key: 'GET /fapi/v1/premiumIndex', op: market },
        { id: 'Market.position', w: 'GET', key: 'GET /fapi/v3/positionRisk', op: market },
        { id: 'Market.entry', w: 'POST', key: 'POST /fapi/v1/order', op: market, wr: 'entry' },
        { id: 'Market.sl', w: 'POST', key: 'POST /fapi/v1/algoOrder', filter: isSl, op: market, wr: 'sl' },
        { id: 'Market.tp', w: 'POST', key: 'POST /fapi/v1/algoOrder', filter: isTp, op: market, wr: 'tp' },
        { id: 'Reconcile.query', w: 'GET', key: 'GET /fapi/v1/order', prefix: 1, base: baseEntryExec, op: market },
        { id: 'Reconcile.position', w: 'GET', key: 'GET /fapi/v3/positionRisk', prefix: 1, base: baseEntryNo, op: market },
        { id: 'Protect.open', w: 'GET', key: 'GET /fapi/v1/openAlgoOrders', base: baseSl, op: market },
        { id: 'Protect.query', w: 'GET', key: 'GET /fapi/v1/algoOrder', base: baseSl, op: market },
        { id: 'Protect.order', w: 'GET', key: 'GET /fapi/v1/order', prefix: 1, base: baseSl, op: market },
        { id: 'Protect.position', w: 'GET', key: 'GET /fapi/v3/positionRisk', prefix: 1, base: baseSl, op: market },
        { id: 'PlaceProtection.position', w: 'GET', key: 'GET /fapi/v3/positionRisk', seed: seedPosition, op: place },
        { id: 'PlaceProtection.sl', w: 'POST', key: 'POST /fapi/v1/algoOrder', filter: isSl, seed: seedPosition, op: place, wr: 'sl' },
        { id: 'PlaceProtection.tp', w: 'POST', key: 'POST /fapi/v1/algoOrder', filter: isTp, seed: seedPosition, op: place, wr: 'tp' },
        { id: 'PlaceProtection.precheck', w: 'GET', key: 'GET /fapi/v1/algoOrder', seed: seedPosition, op: place },
        { id: 'MarketEntry.order', w: 'POST', key: 'POST /fapi/v1/order', op: marketEntry, wr: 'entry' },
        { id: 'MarketEntry.gate', w: 'GET', key: 'GET /fapi/v1/order', op: marketEntryId },
        { id: 'MarketEntry.position', w: 'GET', key: 'GET /fapi/v3/positionRisk', op: marketEntry },
        { id: 'QuerySymbol.exchangeInfo', w: 'GET', key: 'GET /fapi/v1/exchangeInfo', op: (st) => webina.opBinaContractQuerySymbolInfor(st, 'ETHUSDT', opt) },
        { id: 'QueryAccount.account', w: 'GET', key: 'GET /fapi/v3/account', op: (st) => webina.opBinaContractQueryAccountInfor(st, opt) },
        { id: 'QueryPosition.positionRisk', w: 'GET', key: 'GET /fapi/v3/positionRisk', op: (st) => webina.opBinaContractQueryPositionInfor(st, opt) },
        { id: 'QueryOrderInfo.order', w: 'GET', key: 'GET /fapi/v1/order', op: queryInfo, carried: true },
        { id: 'QueryOrderInfo.openAlgo', w: 'GET', key: 'GET /fapi/v1/openAlgoOrders', op: queryInfo, carried: true },
        { id: 'QueryOrderInfo.algo', w: 'GET', key: 'GET /fapi/v1/algoOrder', op: queryInfo, carried: true },
        { id: 'QueryByClientId.order', w: 'GET', key: 'GET /fapi/v1/order', op: (st) => webina.opBinaContractQueryOrderByClientId(st, { clientOrderId: 'x' }, opt), carried: true },
        { id: 'QueryByClientId.algo', w: 'GET', key: 'GET /fapi/v1/algoOrder', op: (st) => webina.opBinaContractQueryOrderByClientId(st, { clientAlgoId: 'x' }, opt), carried: true },
        { id: 'ListOrders.open', w: 'GET', key: 'GET /fapi/v1/openOrders', op: (st) => webina.opBinaContractListOrders(st, opt) },
        { id: 'ListOrders.openAlgo', w: 'GET', key: 'GET /fapi/v1/openAlgoOrders', op: (st) => webina.opBinaContractListOrders(st, opt) },
        { id: 'History.allOrders', w: 'GET', key: 'GET /fapi/v1/allOrders', op: (st) => webina.opBinaContractListOrdersHistory(st, ott, T0, T1, opt) },
        { id: 'History.allAlgo', w: 'GET', key: 'GET /fapi/v1/allAlgoOrders', op: (st) => webina.opBinaContractListOrdersHistory(st, ott, T0, T1, opt) },
        { id: 'Trades.userTrades', w: 'GET', key: 'GET /fapi/v1/userTrades', op: (st) => webina.opBinaContractListTradesFilled(st, ott, T0, T1, opt) },
        { id: 'Cancel.order', w: 'DELETE', key: 'DELETE /fapi/v1/order', seed: seedCancel, op: cancelOrder, wr: 'cancel' },
        { id: 'Cancel.open', w: 'GET', key: 'GET /fapi/v1/openOrders', seed: seedCancel, base: baseDel('DELETE /fapi/v1/order'), op: cancelOrder },
        { id: 'Cancel.query', w: 'GET', key: 'GET /fapi/v1/order', seed: seedCancel, base: baseDel2011('DELETE /fapi/v1/order'), op: cancelOrder },
        { id: 'CancelAlgo.algo', w: 'DELETE', key: 'DELETE /fapi/v1/algoOrder', seed: seedCancel, op: cancelAlgo, wr: 'cancel' },
        { id: 'CancelAlgo.open', w: 'GET', key: 'GET /fapi/v1/openAlgoOrders', seed: seedCancel, base: baseDel('DELETE /fapi/v1/algoOrder'), op: cancelAlgo },
        { id: 'CancelAlgo.query', w: 'GET', key: 'GET /fapi/v1/algoOrder', seed: seedCancel, base: baseDel2011('DELETE /fapi/v1/algoOrder'), op: cancelAlgo },
        { id: 'CancelAll.order', w: 'DELETE', key: 'DELETE /fapi/v1/allOpenOrders', op: cancelAll, wr: 'cancel' },
        { id: 'CancelAll.open', w: 'GET', key: 'GET /fapi/v1/openOrders', base: baseDel('DELETE /fapi/v1/allOpenOrders'), op: cancelAll },
        { id: 'CancelAll.algo', w: 'DELETE', key: 'DELETE /fapi/v1/algoOpenOrders', op: (st) => webina.opBinaContractCancelAllAlgoOrder(st, opt), wr: 'cancel' },
        { id: 'Residual.listOpen', w: 'GET', key: 'GET /fapi/v1/openOrders', seed: seedResidual, op: residual },
        { id: 'Residual.listAlgo', w: 'GET', key: 'GET /fapi/v1/openAlgoOrders', seed: seedResidual, op: residual },
        { id: 'Residual.position', w: 'GET', key: 'GET /fapi/v3/positionRisk', seed: seedResidual, op: residual },
        { id: 'Residual.cancelOrder', w: 'DELETE', key: 'DELETE /fapi/v1/order', seed: seedResidual, op: residual, carried: true },
        { id: 'Residual.cancelAlgo', w: 'DELETE', key: 'DELETE /fapi/v1/algoOrder', seed: seedResidual, op: residual, carried: true },
        { id: 'Residual.partner', w: 'GET', key: 'GET /fapi/v1/algoOrder', seed: seedPartner, op: residual, carried: true },
        { id: 'SpotMarket.order', w: 'POST', key: 'POST /api/v3/order', op: (st) => webina.opBinaSpotMarket(st, ott, tdid(), 10, 0.04, 0.02, opt), wr: 'entry' },
        { id: 'SpotMarket.oco', w: 'POST', key: 'POST /api/v3/orderList/oco', op: (st) => webina.opBinaSpotMarket(st, ott, tdid(), 10, 0.04, 0.02, opt), wr: 'entry' },
        { id: 'SpotLimit.otoco', w: 'POST', key: 'POST /api/v3/orderList/otoco', op: (st) => webina.opBinaSpotLimit(st, ott, tdid(), 3000, 10, 0.04, 0.02, opt), wr: 'entry' },
    ]

    let times = (n, a) => Array.from({ length: n }, () => ({ ...a }))
    let replyErr = (status, body) => ({ reply: { status, body } })

    //結果: 名稱含「已執行」表該請求於伺服器已處理
    let outcomes = {
        '逾時1次(已執行)': [{ exec: true, reply: 'hang' }],
        '逾時2次(未執行)': times(2, { exec: false, reply: 'hang' }),
        '全部逾時(未執行)': times(40, { exec: false, reply: 'hang' }),
        '連線重置1次(未執行)': times(1, { exec: false, reply: 'reset' }),
        '連線重置全部(未執行)': times(40, { exec: false, reply: 'reset' }),
        '連線重置全部(首次已執行)': [{ exec: true, reply: 'reset' }, ...times(40, { exec: false, reply: 'reset' })],
        '500': times(40, replyErr(500, { code: -1000, msg: 'x' })),
        '502(HTML)': times(40, replyErr(502, '<html>Bad Gateway</html>')),
        '503(已執行)': [{ exec: true, reply: { status: 503, body: { code: -1000, msg: 'x' } } }, ...times(40, replyErr(503, { code: -1000, msg: 'x' }))],
        '503': times(40, replyErr(503, { code: -1001, msg: 'x' })),
        '503一次後正常': times(1, replyErr(503, { code: -1000, msg: 'x' })),
        '504': times(40, replyErr(504, '')),
        '400/-1021': times(40, { reply: r1021 }),
        '400/-1007(已執行)': [{ exec: true, reply: { status: 400, body: { code: -1007, msg: 'x' } } }],
        '400/-1006(已執行)': [{ exec: true, reply: { status: 400, body: { code: -1006, msg: 'x' } } }],
        '400/-2011': times(40, replyErr(400, { code: -2011, msg: 'x' })),
        '400/-2013': times(40, replyErr(400, { code: -2013, msg: 'x' })),
        '400/-4116': times(40, replyErr(400, { code: -4116, msg: 'x' })),
        '408/-1007(已執行)': [{ exec: true, reply: { status: 408, body: { code: -1007, msg: 'x' } } }],
        '429/-1015': times(40, replyErr(429, { code: -1015, msg: 'x' })),
        '418': times(40, replyErr(418, { code: -1003, msg: 'x' })),
        '401/-2015': times(40, replyErr(401, { code: -2015, msg: 'x' })),
        '403(WAF HTML)': times(40, replyErr(403, '<html>Forbidden</html>')),
        '404': times(40, replyErr(404, '<html>Not Found</html>')),
        '400/白名單外碼': times(40, replyErr(400, { code: -9999, msg: 'x' })),
        '200非JSON(已執行)': [{ exec: true, reply: { status: 200, body: '<html>oops</html>' } }],
        '200空本體(已執行)': [{ exec: true, reply: { status: 200, body: '' } }],
        '200含錯誤碼': times(40, replyErr(200, { code: -1000, msg: 'x' })),
    }

    let isExecutedOutcome = (name) => name.includes('已執行')

    let results = []
    let nCells = sites.length * Object.keys(outcomes).length

    let runPool = async (items, n, fn) => {
        let i = 0
        let workers = Array.from({ length: n }, async () => {
            while (i < items.length) {
                let cur = items[i++]
                await fn(cur)
            }
        })
        await Promise.all(workers)
    }

    before(async () => {
        await startFake()
        let cases = []
        for (let s of sites) {
            for (let name of Object.keys(outcomes)) {
                cases.push({ s, name })
            }
        }
        await runPool(cases, 100, async ({ s, name }) => {
            let fx = mkFake()
            if (s.seed) {
                s.seed(fx)
            }
            if (s.base) {
                s.base(fx)
            }
            let seq = [...times(s.prefix || 0, { exec: true }), ...outcomes[name].map((a) => ({ ...a }))]
            if (s.filter) {
                fx.on(s.key, s.filter, seq)
            }
            else {
                fx.on(s.key, seq)
            }
            let row = { site: s.id, outcome: name, s, fx }
            try {
                row.ret = await s.op(fx.st)
                row.ok = true
            }
            catch (err) {
                row.err = err
                row.ok = false
            }
            results.push(row)
        })
    })

    after(async () => {
        await stopFake()
        assert.deepStrictEqual(blocked, [], '不得有連外嘗試')
    })

    it('矩陣格數全跑完; 故障確實注入目標站', () => {
        assert.strictEqual(results.length, nCells)
        let bad = []
        for (let r of results) {
            //進場或閘已先失敗時, 較後之站到不了, 故只要求最先之站有收到請求
            if (r.s.id === 'Market.gate' || r.s.id === 'MarketEntry.order' || r.s.id === 'CancelAll.order') {
                if (r.fx.count(r.s.key, r.s.filter) === 0) {
                    bad.push(`${r.site}/${r.outcome}`)
                }
            }
        }
        assert.deepStrictEqual(bad, [])
    })

    it('不變式①: 拋錯一律為BinaOpError, 帶execState且值合法; 不得為無類別Error或TypeError', () => {
        let bad = []
        for (let r of results) {
            if (!r.ok) {
                let okType = r.err && r.err.name === 'BinaOpError'
                let okState = r.err && ['unknown', 'notExecuted', 'executed'].includes(r.err.execState)
                if (!okType || !okState) {
                    bad.push(`${r.site}/${r.outcome}: ${r.err && r.err.name}: ${r.err && r.err.message}`)
                }
            }
        }
        assert.deepStrictEqual(bad, [])
    })

    it('不變式②: 進場POST每次呼叫至多1次(不重送進場單); 現貨買入與OCO、OTOCO亦同', () => {
        let bad = []
        for (let r of results) {
            for (let key of ['POST /fapi/v1/order', 'POST /api/v3/order', 'POST /api/v3/orderList/oco', 'POST /api/v3/orderList/otoco']) {
                let n = r.fx.count(key)
                if (n > 1) {
                    bad.push(`${r.site}/${r.outcome}: ${key} ${n}`)
                }
            }
        }
        assert.deepStrictEqual(bad, [])
    })

    it('不變式③: 寫入站伺服器已執行時, 呼叫端不得得到未執行(進場、取消之execState; 保護腿之notPlaced)', () => {
        let bad = []
        for (let r of results) {
            if (!r.s.wr || !isExecutedOutcome(r.outcome) || r.ok) {
                continue
            }
            if ((r.s.wr === 'entry' || r.s.wr === 'cancel') && r.err.execState === 'notExecuted') {
                bad.push(`${r.site}/${r.outcome}: ${r.err.outcome}`)
            }
            if ((r.s.wr === 'sl' || r.s.wr === 'tp') && r.err.state && r.err.state[r.s.wr] && r.err.state[r.s.wr].status === 'notPlaced') {
                bad.push(`${r.site}/${r.outcome}: notPlaced`)
            }
        }
        assert.deepStrictEqual(bad, [])
    })

    it('不變式④: 進場未成交或狀態未知時絕不掛保護單; 且失敗結果之state.entry與假交易所一致', () => {
        let bad = []
        for (let r of results) {
            if (r.s.op === market && !r.ok && ['NOT_ENTERED', 'ENTRY_UNKNOWN', 'TDID_USED'].includes(r.err.outcome)) {
                if (r.fx.count('POST /fapi/v1/algoOrder') !== 0) {
                    bad.push(`${r.site}/${r.outcome}: algo`)
                }
            }
            if (r.s.op === market && !r.ok && r.err.outcome === 'NOT_ENTERED' && r.fx.ex.orders.length > 0) {
                bad.push(`${r.site}/${r.outcome}: NOT_ENTERED而假交易所有單`)
            }
        }
        assert.deepStrictEqual(bad, [])
    })

    it('不變式⑤: 無舊時間戳重送(同時間戳之請求送達時差須極小, 重試間隔至少200ms)', () => {
        let bad = []
        for (let r of results) {
            let byTs = {}
            for (let q of r.fx.reqs) {
                if (q.timestamp) {
                    byTs[`${q.key}|${q.timestamp}`] = [...(byTs[`${q.key}|${q.timestamp}`] || []), q.t]
                }
            }
            for (let k of Object.keys(byTs)) {
                let ts = byTs[k]
                if (Math.max(...ts) - Math.min(...ts) >= 150) {
                    bad.push(`${r.site}/${r.outcome}: ${k}`)
                }
            }
        }
        assert.deepStrictEqual(bad, [])
    })

    it('不變式⑥: 全部情境簽章年齡皆小於recvWindow; 簽章請求一律帶recvWindow=5000', () => {
        let bad = []
        for (let r of results) {
            for (let q of r.fx.reqs) {
                if (q.age !== null && q.age > 5000) {
                    bad.push(`${r.site}/${r.outcome}: ${q.key} age ${q.age}`)
                }
                if (q.signed && q.p.recvWindow !== '5000') {
                    bad.push(`${r.site}/${r.outcome}: ${q.key} recvWindow ${q.p.recvWindow}`)
                }
            }
        }
        assert.deepStrictEqual(bad, [])
    })

    it('不變式⑦: Market成功回傳者, 假交易所須有成交之進場單與兩張開啟之保護單, 量與回傳相同', () => {
        let bad = []
        let nOk = 0
        for (let r of results) {
            if (r.s.op !== market || !r.ok) {
                continue
            }
            nOk++
            let filled = r.fx.ex.orders.filter((o) => o.status === 'FILLED')
            let open = r.fx.ex.algos.filter((o) => o.algoStatus === 'NEW')
            let kinds = open.map((o) => o.orderType).sort().join(',')
            if (filled.length !== 1 || kinds !== 'STOP_MARKET,TAKE_PROFIT_MARKET') {
                bad.push(`${r.site}/${r.outcome}: filled ${filled.length} open ${kinds}`)
            }
            for (let o of open) {
                if (Number(o.quantity) !== Number(r.ret.quantity)) {
                    bad.push(`${r.site}/${r.outcome}: qty ${o.quantity} vs ${r.ret.quantity}`)
                }
            }
        }
        assert.ok(nOk > 50, `成功格數 ${nOk}`)
        assert.deepStrictEqual(bad, [])
    })

    it('不變式⑧: 結果承載型(QueryOrderInfo、QueryByClientId、Residual撤單與對腳)不拋錯', () => {
        let bad = []
        for (let r of results) {
            if (r.s.carried && !r.ok) {
                bad.push(`${r.site}/${r.outcome}: ${r.err.message}`)
            }
        }
        assert.deepStrictEqual(bad, [])
    })

})
