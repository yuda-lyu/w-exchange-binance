import assert from 'assert'
import { mock } from 'node:test'
import ott from '../src/ott.mjs'
import webina from '../src/WExchangeBinance.mjs'
import { blocked, catchErr, mkFake, mkTraceRec, r2013, startFake, stopFake } from './tools/binaFakeServer.mjs'


//讀取由本套件重試並重新簽章(bx297 §5.3, T01～T04、T38、T39、T43、T70、P15、P27、P28)
describe('讀取類 (本機假伺服器)', function() {

    before(async () => {
        await startFake()
    })
    after(async () => {
        await stopFake()
        assert.deepStrictEqual(blocked, [], '不得有連外嘗試')
    })

    let T0 = '2026-11-01T00:00:00'
    let T1 = '2026-11-02T00:00:00'
    let opt = { forceTest: true }

    //12個GET站點
    let sites = [
        { id: 'Market.markPrice', key: 'GET /fapi/v1/premiumIndex', run: (st) => webina.opBinaContractMarket(st, ott, 'long', `tdid-${Date.now()}-m`, 22, 0.04, 0.02, opt), unsigned: true },
        { id: 'Market.positionRisk', key: 'GET /fapi/v3/positionRisk', run: (st) => webina.opBinaContractMarket(st, ott, 'long', `tdid-${Date.now()}-p`, 22, 0.04, 0.02, opt) },
        { id: 'QuerySymbol', key: 'GET /fapi/v1/exchangeInfo', run: (st) => webina.opBinaContractQuerySymbolInfor(st, 'ETHUSDT', opt), unsigned: true },
        { id: 'QueryAccount', key: 'GET /fapi/v3/account', run: (st) => webina.opBinaContractQueryAccountInfor(st, opt) },
        { id: 'QueryPosition', key: 'GET /fapi/v3/positionRisk', run: (st) => webina.opBinaContractQueryPositionInfor(st, opt) },
        { id: 'QueryOrderInfo.order', key: 'GET /fapi/v1/order', run: (st) => webina.opBinaContractQueryOrderInfo(st, { idEntry: '111' }, opt) },
        { id: 'QueryOrderInfo.openAlgo', key: 'GET /fapi/v1/openAlgoOrders', run: (st) => webina.opBinaContractQueryOrderInfo(st, { idSl: '222' }, opt) },
        { id: 'ListOrders.open', key: 'GET /fapi/v1/openOrders', run: (st) => webina.opBinaContractListOrders(st, opt) },
        { id: 'ListOrders.openAlgo', key: 'GET /fapi/v1/openAlgoOrders', run: (st) => webina.opBinaContractListOrders(st, opt) },
        { id: 'History.allOrders', key: 'GET /fapi/v1/allOrders', run: (st) => webina.opBinaContractListOrdersHistory(st, ott, T0, T1, opt) },
        { id: 'History.allAlgo', key: 'GET /fapi/v1/allAlgoOrders', run: (st) => webina.opBinaContractListOrdersHistory(st, ott, T0, T1, opt) },
        { id: 'Trades', key: 'GET /fapi/v1/userTrades', run: (st) => webina.opBinaContractListTradesFilled(st, ott, T0, T1, opt) },
    ]

    //QueryOrderInfo以結果物件承載失敗, 不拋
    let isCarried = (id) => id.startsWith('QueryOrderInfo')

    for (let s of sites) {

        it(`T01 ${s.id}: 無回應2次後第3次成功, 時間戳每次不同(修前沿用舊時間戳)`, async () => {
            let fx = mkFake()
            fx.on(s.key, [{ reply: 'reset' }, { reply: 'reset' }])
            await s.run(fx.st).catch((err) => {
                //Market之站點, 進場後假伺服器其餘正常, 應全成; 其他拋錯都算失敗
                throw err
            })
            let rows = fx.reqsOf(s.key)
            assert.ok(rows.length >= 3, `${s.key} 送出次數 ${rows.length}`)
            if (!s.unsigned) {
                let ts = rows.slice(0, 3).map((r) => r.timestamp)
                assert.strictEqual(new Set(ts).size, 3, `時間戳須每次不同: ${ts}`)
            }
        })

        it(`T02 ${s.id}: 全部無回應, ${isCarried(s.id) ? '結果物件errKind:UNKNOWN' : (s.id.startsWith('Market.') ? 'NOT_ENTERED{mark}且不送單' : 'execState unknown, attempts 3')}`, async () => {
            let fx = mkFake()
            fx.on(s.key, Array.from({ length: 20 }, () => ({ reply: 'reset' })))
            if (isCarried(s.id)) {
                let r = await s.run(fx.st)
                let leg = r.resEntry || r.resSl
                assert.strictEqual(leg.found, false)
                assert.strictEqual(leg.errKind, 'UNKNOWN')
                return
            }
            let err = await catchErr(s.run(fx.st))
            if (s.id.startsWith('Market.')) {
                assert.strictEqual(err.outcome, 'NOT_ENTERED')
                assert.strictEqual(err.state.stage, 'mark')
                assert.strictEqual(fx.count('POST /fapi/v1/order'), 0, '讀不到不得送單')
            }
            else {
                assert.strictEqual(err.execState, 'unknown')
                assert.strictEqual(err.binance.attempts, 3)
            }
        })

    }

    it('T01 真實逾時: 請求掛住2次後第3次成功, 伺服器所見每次時間戳年齡<1000(修前第3次約5秒而-1021)', async () => {
        let fx = mkFake()
        fx.on('GET /fapi/v3/account', [{ reply: 'hang' }, { reply: 'hang' }])
        let r = await webina.opBinaContractQueryAccountInfor(fx.st, opt)
        assert.strictEqual(r.totalWalletBalance, '1000')
        let rows = fx.reqsOf('GET /fapi/v3/account')
        assert.strictEqual(rows.length, 3)
        for (let row of rows) {
            assert.ok(row.age < 1000, `年齡 ${row.age}`)
        }
    })

    it('T02 真實逾時: 全部掛住, 類別固定, execState unknown, attempts 3(修前無類別Error或-1021)', async () => {
        let fx = mkFake()
        fx.on('GET /fapi/v3/account', [{ reply: 'hang' }, { reply: 'hang' }, { reply: 'hang' }, { reply: 'hang' }])
        let err = await catchErr(webina.opBinaContractQueryAccountInfor(fx.st, opt))
        assert.strictEqual(err.name, 'BinaOpError')
        assert.strictEqual(err.execState, 'unknown')
        assert.strictEqual(err.binance.attempts, 3)
        assert.strictEqual(err.binance.kind, 'network')
        assert.strictEqual(fx.count('GET /fapi/v3/account'), 3)
    })

    it('T03 GET 5xx一次後正常: 成功, 時間戳每次不同(修前成功但舊時間戳)', async () => {
        let fx = mkFake()
        fx.on('GET /fapi/v3/account', [{ reply: { status: 503, body: { code: -1000, msg: 'Service Unavailable.' } } }])
        let r = await webina.opBinaContractQueryAccountInfor(fx.st, opt)
        assert.strictEqual(r.totalWalletBalance, '1000')
        let rows = fx.reqsOf('GET /fapi/v3/account')
        assert.strictEqual(rows.length, 2)
        assert.notStrictEqual(rows[0].timestamp, rows[1].timestamp)
    })

    it('T04 GET -2013、-1021、401、429、418: 只送1次', async () => {
        let cases = [
            { reply: r2013, kind: 'notObserved' },
            { reply: { status: 400, body: { code: -1021, msg: 'x' } }, kind: 'rejected' },
            { reply: { status: 401, body: { code: -2015, msg: 'x' } }, kind: 'rejected' },
            { reply: { status: 429, body: { code: -1003, msg: 'x' } }, kind: 'rateLimited' },
            { reply: { status: 418, body: { code: -1003, msg: 'x' } }, kind: 'rateLimited' },
            { reply: { status: 429, body: '' }, kind: 'rateLimited' },
        ]
        for (let c of cases) {
            let fx = mkFake()
            fx.on('GET /fapi/v3/account', [{ reply: c.reply }, { reply: c.reply }, { reply: c.reply }])
            let err = await catchErr(webina.opBinaContractQueryAccountInfor(fx.st, opt))
            assert.strictEqual(fx.count('GET /fapi/v3/account'), 1, c.kind)
            assert.strictEqual(err.binance.kind, c.kind)
            assert.strictEqual(err.binance.attempts, 1)
        }
    })

    it('T02b 200本體不符(非JSON、空、含錯誤碼): 重試後未知, 不得當成功(修前TypeError或當成功)', async () => {
        for (let body of ['<html>oops</html>', '', { code: -1000, msg: 'x' }]) {
            let fx = mkFake()
            fx.on('GET /fapi/v1/openOrders', [{ reply: { status: 200, body } }, { reply: { status: 200, body } }, { reply: { status: 200, body } }])
            let err = await catchErr(webina.opBinaContractListOrders(fx.st, opt))
            assert.strictEqual(err.execState, 'unknown')
            assert.strictEqual(err.binance.kind, 'invalidBody')
            assert.strictEqual(err.binance.attempts, 3)
        }
    })

    it('T38 QueryOrderInfo: 未見與網路失敗以errKind區分(修前同型字串)', async () => {
        let fx = mkFake()
        let r = await webina.opBinaContractQueryOrderInfo(fx.st, { idEntry: '99', idSl: '98' }, opt)
        assert.strictEqual(r.resEntry.found, false)
        assert.strictEqual(r.resEntry.errKind, 'NOT_OBSERVED')
        assert.strictEqual(r.resEntry.code, -2013)
        assert.strictEqual(r.resSl.errKind, 'NOT_OBSERVED')
        let fx2 = mkFake()
        fx2.on('GET /fapi/v1/order', Array.from({ length: 3 }, () => ({ reply: 'reset' })))
        fx2.on('GET /fapi/v1/openAlgoOrders', Array.from({ length: 3 }, () => ({ reply: 'reset' })))
        let r2 = await webina.opBinaContractQueryOrderInfo(fx2.st, { idEntry: '99', idSl: '98' }, opt)
        assert.strictEqual(r2.resEntry.errKind, 'UNKNOWN')
        assert.strictEqual(r2.resSl.errKind, 'UNKNOWN', 'open清單失敗而單筆查無者不得當未見')
        assert.strictEqual(r2.resTp, null)
    })

    it('T39 QueryOrderInfo只給tdid: 以tdid_ENTRY、_SL、_TP查', async () => {
        let fx = mkFake()
        fx.ex.addOrder({ clientOrderId: 'td39_ENTRY' })
        fx.ex.addAlgo({ clientAlgoId: 'td39_SL' })
        fx.ex.addAlgo({ clientAlgoId: 'td39_TP', algoStatus: 'FINISHED' })
        let r = await webina.opBinaContractQueryOrderInfo(fx.st, { tdid: 'td39' }, opt)
        assert.strictEqual(r.resEntry.found, true)
        assert.strictEqual(r.resEntry.clientOrderId, 'td39_ENTRY')
        assert.strictEqual(r.resSl.clientAlgoId, 'td39_SL', '開啟中由open清單取得')
        assert.strictEqual(r.resTp.algoStatus, 'FINISHED', '已觸發由queryAlgoOrder取得')
        assert.strictEqual(r.idEntry, String(r.resEntry.orderId))
    })

    it('T39 QueryOrderByClientId: 普通與algo, 查無與失敗', async () => {
        let fx = mkFake()
        fx.ex.addOrder({ clientOrderId: 'c39' })
        fx.ex.addAlgo({ clientAlgoId: 'a39' })
        let r1 = await webina.opBinaContractQueryOrderByClientId(fx.st, { clientOrderId: 'c39' }, opt)
        assert.strictEqual(r1.found, true)
        assert.strictEqual(r1.order.clientOrderId, 'c39')
        let r2 = await webina.opBinaContractQueryOrderByClientId(fx.st, { clientAlgoId: 'a39' }, opt)
        assert.strictEqual(r2.found, true)
        assert.strictEqual(r2.order.clientAlgoId, 'a39')
        let r3 = await webina.opBinaContractQueryOrderByClientId(fx.st, { clientOrderId: 'none' }, opt)
        assert.deepStrictEqual([r3.found, r3.errKind, r3.code], [false, 'NOT_OBSERVED', -2013])
        fx.on('GET /fapi/v1/order', Array.from({ length: 3 }, () => ({ reply: 'reset' })))
        let r4 = await webina.opBinaContractQueryOrderByClientId(fx.st, { clientOrderId: 'c39' }, opt)
        assert.deepStrictEqual([r4.found, r4.errKind], [false, 'UNKNOWN'])
        //opt.symbol
        await webina.opBinaContractQueryOrderByClientId(fx.st, { clientOrderId: 'c39' }, { ...opt, symbol: 'BTCUSDT' })
        assert.strictEqual(fx.reqsOf('GET /fapi/v1/order').at(-1).p.symbol, 'BTCUSDT')
    })

    it('K2 無效參數入口拋錯不回顯值, 請求0次', async () => {
        let fx = mkFake()
        for (let v of [null, 'echo-me', {}, { clientOrderId: 'echo-me', clientAlgoId: 'echo-me' }, { clientOrderId: '' }]) {
            let err = await catchErr(webina.opBinaContractQueryOrderByClientId(fx.st, v, opt))
            assert.match(err.message, /^invalid ids/)
            assert.ok(!err.message.includes('echo-me'))
        }
        for (let v of [null, {}, { idEntry: -1 }, { idEntry: BigInt(1) }, { idEntry: 'echo-me' }]) {
            let err = await catchErr(webina.opBinaContractQueryOrderInfo(fx.st, v, opt))
            assert.match(err.message, /^invalid o/)
            assert.ok(!err.message.includes('echo-me'))
        }
        assert.strictEqual(fx.reqs.length, 0)
    })

    it('§5.2.1 部位列缺欄不得當0; 商品資訊缺symbols不得報非上市: 視為讀取失敗', async () => {
        for (let row of [{ positionSide: 'LONG' }, { positionAmt: '1' }, { positionSide: 'LONG', positionAmt: 'x' }]) {
            let fx = mkFake()
            let body = [row]
            fx.on('GET /fapi/v3/positionRisk', [{ reply: { status: 200, body } }, { reply: { status: 200, body } }, { reply: { status: 200, body } }])
            let err = await catchErr(webina.opBinaContractQueryPositionInfor(fx.st, opt))
            assert.strictEqual(err.binance.kind, 'invalidBody')
            assert.strictEqual(err.binance.attempts, 3)
        }
        let fx2 = mkFake()
        let body = { timezone: 'UTC' }
        fx2.on('GET /fapi/v1/exchangeInfo', [{ reply: { status: 200, body } }, { reply: { status: 200, body } }, { reply: { status: 200, body } }])
        let err2 = await catchErr(webina.opBinaContractQuerySymbolInfor(fx2.st, 'ETHUSDT', opt))
        assert.strictEqual(err2.binance.kind, 'invalidBody')
        let fx3 = mkFake()
        let err3 = await catchErr(webina.opBinaContractQuerySymbolInfor(fx3.st, 'NOPEUSDT', opt))
        assert.match(err3.message, /invalid SYMBOL/)
    })

    it('T70 歷史單algo成交量讀actualQty(修前讀executedQty恆為0); tdid依字尾解析', async () => {
        let fx = mkFake()
        fx.ex.addAlgo({ clientAlgoId: 'a_b_SL', algoStatus: 'FINISHED', actualQty: '0.012', createTime: Date.parse('2026-11-01T01:00:00+08:00') })
        fx.ex.addOrder({ clientOrderId: 'a_b_ENTRY', executedQty: '0.012', time: Date.parse('2026-11-01T01:00:00+08:00') })
        let rs = await webina.opBinaContractListOrdersHistory(fx.st, ott, T0, T1, opt)
        let algo = rs.find((o) => o.isAlgo)
        assert.strictEqual(algo.executedQty, 0.012)
        assert.deepStrictEqual([algo.tdid, algo.kind], ['a_b', 'SL'])
        let norm = rs.find((o) => !o.isAlgo)
        assert.deepStrictEqual([norm.tdid, norm.kind, norm.executedQty], ['a_b', 'ENTRY', 0.012])
    })

    it('P28 分頁: 滿頁且同毫秒尚有資料不漏筆(修前time+1漏筆); 歷史與成交皆然', async () => {
        //1000筆滿頁, 最後2筆與第1001筆同毫秒
        let tBase = Date.parse('2026-11-01T01:00:00+08:00')
        let mk = (i) => {
            return { orderId: 1000 + i, clientOrderId: `o${i}_ENTRY`, time: tBase + (i >= 998 ? 998 : i), id: 5000 + i, price: '1', qty: '1', quoteQty: '1', commission: '0', realizedPnl: '0' }
        }
        let all = Array.from({ length: 1003 }, (_, i) => mk(i))
        let paged = ({ p }) => {
            let start = Number(p.get('startTime'))
            let page = all.filter((o) => o.time >= start).slice(0, 1000)
            return { status: 200, body: page }
        }
        let fx = mkFake()
        fx.on('GET /fapi/v1/allOrders', Array.from({ length: 5 }, () => ({ reply: paged })))
        let rs = await webina.opBinaContractListOrdersHistory(fx.st, ott, T0, T1, opt)
        assert.strictEqual(rs.length, 1003)
        let fx2 = mkFake()
        fx2.on('GET /fapi/v1/userTrades', Array.from({ length: 5 }, () => ({ reply: paged })))
        let ts = await webina.opBinaContractListTradesFilled(fx2.st, ott, T0, T1, opt)
        assert.strictEqual(ts.length, 1003)
    })

    it('P28 分頁: 滿頁全同毫秒無法推進時拋錯, 不得靜默漏筆', async () => {
        let tBase = Date.parse('2026-11-01T01:00:00+08:00')
        let page = Array.from({ length: 1000 }, (_, i) => ({ orderId: 1000 + i, clientOrderId: `o${i}_ENTRY`, time: tBase }))
        let fx = mkFake()
        fx.on('GET /fapi/v1/allOrders', Array.from({ length: 5 }, () => ({ reply: { status: 200, body: page } })))
        let err = await catchErr(webina.opBinaContractListOrdersHistory(fx.st, ott, T0, T1, opt))
        assert.strictEqual(err.outcome, 'PAGINATION_STUCK')
    })

    it('P24 不印全部symbol, 不於函式庫內console.log', async () => {
        let fx = mkFake()
        let logs = []
        let orig = console.log
        console.log = (...a) => logs.push(a)
        try {
            let r = await webina.opBinaContractQuerySymbolInfor(fx.st, 'ETHUSDT', opt)
            assert.strictEqual(r.symbol, 'ETHUSDT')
            fx.on('GET /fapi/v3/account', [{ reply: 'reset' }, { reply: 'reset' }, { reply: 'reset' }])
            await catchErr(webina.opBinaContractQueryAccountInfor(fx.st, opt))
        }
        finally {
            console.log = orig
        }
        assert.deepStrictEqual(logs, [])
    })

    it('T43 callBinaRead觀察回調: attempt、retry、giveUp內容; 五種回調案結果相同', async () => {
        let unhandled = []
        let onUnhandled = (e) => unhandled.push(e)
        process.on('unhandledRejection', onUnhandled)
        try {
            let rec = mkTraceRec()
            let modes = [
                {},
                { onTrace: rec.onTrace },
                {
                    onTrace: () => {
                        throw new Error('cb')
                    },
                },
                { onTrace: () => Promise.reject(new Error('cb')) },
                { onTrace: 123 },
            ]
            let results = []
            for (let m of modes) {
                let fx = mkFake()
                fx.on('GET /fapi/v3/account', [{ reply: 'reset' }, { reply: 'reset' }, { reply: 'reset' }])
                let err = await catchErr(webina.opBinaContractQueryAccountInfor(fx.st, { ...opt, ...m }))
                results.push([err.execState, err.binance.attempts, fx.count('GET /fapi/v3/account')])
            }
            await new Promise((resolve) => setImmediate(resolve))
            for (let x of results) {
                assert.deepStrictEqual(x, results[0])
            }
            assert.deepStrictEqual(unhandled, [])
            assert.deepStrictEqual(rec.ofType('attempt').map((e) => e.n), [1, 2, 3])
            assert.deepStrictEqual(rec.ofType('retry').map((e) => [e.n, e.kind]), [[1, 'network'], [2, 'network']])
            assert.deepStrictEqual(rec.ofType('giveUp').map((e) => [e.attempts, e.kind]), [[3, 'network']])
            assert.ok(Object.isFrozen(rec.evs[0]))
        }
        finally {
            process.off('unhandledRejection', onUnhandled)
        }
    })

    //計時器規格 §5 P5: 重試間隔本身是規格, 以假時鐘斷言; 防懸置用真實計時器
    it('T43 callBinaRead間隔以假時鐘驗: 200、400ms, 無回應時才等待', async () => {
        let callBinaRead = (await import('../src/callBinaRead.mjs')).default
        let realSetImmediate = setImmediate
        let flush = () => new Promise((resolve) => realSetImmediate(resolve))
        mock.timers.enable({ apis: ['setTimeout'] })
        try {
            let times = []
            let n = 0
            let fn = async () => {
                n++
                times.push(n)
                if (n < 3) {
                    let { NetworkError } = await import('@binance/common')
                    throw new NetworkError('x')
                }
                return { data: async () => [1] }
            }
            let rec = mkTraceRec()
            let p = callBinaRead(fn, { name: 'x', onTrace: rec.onTrace })
            for (let i = 0; i < 5; i++) {
                await flush()
            }
            assert.strictEqual(n, 1)
            mock.timers.tick(199)
            await flush()
            assert.strictEqual(n, 1, '未滿200ms不得重送')
            mock.timers.tick(1)
            for (let i = 0; i < 5; i++) {
                await flush()
            }
            assert.strictEqual(n, 2)
            mock.timers.tick(399)
            await flush()
            assert.strictEqual(n, 2, '未滿400ms不得重送')
            mock.timers.tick(1)
            for (let i = 0; i < 5; i++) {
                await flush()
            }
            assert.strictEqual(n, 3)
            assert.deepStrictEqual(await p, [1])
            assert.deepStrictEqual(rec.ofType('retry').map((e) => e.delayMs), [200, 400])
        }
        finally {
            mock.timers.reset()
        }
    })

})
