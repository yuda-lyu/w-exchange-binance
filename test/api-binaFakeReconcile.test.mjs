import assert from 'assert'
import ott from '../src/ott.mjs'
import webina from '../src/WExchangeBinance.mjs'
import { blocked, catchErr, mkFake, mkTraceRec, r2013, startFake, stopFake } from './tools/binaFakeServer.mjs'


//回查狀態機(bx297 §5.4): 視窗走真實時間, 約8秒之案集中於本檔(規格P6); 以事件內容斷言, 不斷言恰好幾秒
//同檔各案並行執行以縮短總時間, 情境以金鑰隔離
describe('下單未知回查狀態機 (本機假伺服器, 真實視窗約8秒)', function() {
    this.timeout(180000)

    let K_ORDER = 'POST /fapi/v1/order'
    let K_ALGO = 'POST /fapi/v1/algoOrder'
    let K_QUERY = 'GET /fapi/v1/order'
    let opt = { forceTest: true }
    let nTdid = 0
    let newTdid = () => `tdid-r-${Date.now()}-${++nTdid}`

    let isEntryQuery = (tdid) => (p) => p.get('origClientOrderId') === `${tdid}_ENTRY`

    //閘(查無)之後才開始套回查序列
    let gatePass = { reply: r2013 }

    //Market情境: 回 { fx, rec, tdid, result }
    let scenario = async ({ setup, mode = 'long', entry = null }) => {
        let fx = mkFake()
        let tdid = newTdid()
        let rec = mkTraceRec()
        if (entry) {
            fx.on(K_ORDER, [entry])
        }
        if (setup) {
            setup({ fx, tdid })
        }
        let t0 = Date.now()
        let settled = await webina.opBinaContractMarket(fx.st, ott, mode, tdid, 22, 0.04, 0.02, { ...opt, onTrace: rec.onTrace }).then((r) => ({ r }), (err) => ({ err }))
        return { fx, rec, tdid, ...settled, ms: Date.now() - t0 }
    }

    let reset = { exec: false, reply: 'reset' }
    let cases = {}
    let results = {}

    //T08 未送達、查無、部位不變
    cases.T08 = () => scenario({ entry: reset })

    //T47 -2013 → 查詢全失敗至deadline: 無窗後查無
    cases.T47 = () => scenario({
        entry: reset,
        setup: ({ fx, tdid }) => {
            let n = 0
            fx.on(K_QUERY, isEntryQuery(tdid), [gatePass, { reply: r2013 }, ...Array.from({ length: 40 }, () => ({ reply: 'reset' }))])
            return n
        },
    })

    //T48 NEW → -2013: 曾見存在, 不得判未執行
    cases.T48 = () => scenario({
        entry: reset,
        setup: ({ fx, tdid }) => {
            fx.on(K_QUERY, isEntryQuery(tdid), [
                gatePass,
                { reply: ({ p }) => ({ status: 200, body: { status: 'NEW', orderId: 1, clientOrderId: p.get('origClientOrderId'), executedQty: '0', origQty: '0.007', side: 'BUY', time: Date.now() } }) },
                ...Array.from({ length: 40 }, () => ({ reply: r2013 })),
            ])
        },
    })

    //T49 RESULT 200帶NEW → -2013
    cases.T49 = () => scenario({
        entry: { exec: false, reply: ({ p }) => ({ status: 200, body: { status: 'NEW', orderId: 1, clientOrderId: p.get('newClientOrderId'), executedQty: '0.000', origQty: p.get('quantity'), side: p.get('side'), time: Date.now() } }) },
    })

    //T50 PARTIALLY_FILLED(有量) → -2013
    cases.T50 = () => scenario({
        entry: reset,
        setup: ({ fx, tdid }) => {
            fx.on(K_QUERY, isEntryQuery(tdid), [
                gatePass,
                { reply: ({ p }) => ({ status: 200, body: { status: 'PARTIALLY_FILLED', orderId: 1, clientOrderId: p.get('origClientOrderId'), executedQty: '0.002', origQty: '0.007', side: 'BUY', time: Date.now() } }) },
                ...Array.from({ length: 40 }, () => ({ reply: r2013 })),
            ])
            fx.ex.positions.LONG = 1
        },
    })

    //T51 -1007 → 一直-2013: source:server
    cases.T51 = () => scenario({ entry: { exec: false, reply: { status: 400, body: { code: -1007, msg: 'x' } } } })

    //T52 逾時 → 一直-2013, 部位已變
    cases.T52 = () => scenario({
        entry: reset,
        setup: ({ fx, tdid }) => {
            fx.on(K_QUERY, isEntryQuery(tdid), [gatePass, { before: ({ ex }) => ex.addPos('LONG', 0.007), reply: r2013 }])
        },
    })

    //T54 查得舊單: time早
    cases.T54a = () => scenario({
        entry: reset,
        setup: ({ fx, tdid }) => {
            fx.on(K_QUERY, isEntryQuery(tdid), [gatePass, { reply: ({ p }) => ({ status: 200, body: { status: 'FILLED', orderId: 1, clientOrderId: p.get('origClientOrderId'), executedQty: '0.007', origQty: '0.007', side: 'BUY', time: Date.now() - 60000 } }) }])
        },
    })

    //T54 查得舊單: side不同
    cases.T54b = () => scenario({
        entry: reset,
        setup: ({ fx, tdid }) => {
            fx.on(K_QUERY, isEntryQuery(tdid), [gatePass, { reply: ({ p }) => ({ status: 200, body: { status: 'FILLED', orderId: 1, clientOrderId: p.get('origClientOrderId'), executedQty: '0.007', origQty: '0.007', side: 'SELL', time: Date.now() } }) }])
        },
    })

    //T54 查得舊單: origQty不同
    cases.T54c = () => scenario({
        entry: reset,
        setup: ({ fx, tdid }) => {
            fx.on(K_QUERY, isEntryQuery(tdid), [gatePass, { reply: ({ p }) => ({ status: 200, body: { status: 'FILLED', orderId: 1, clientOrderId: p.get('origClientOrderId'), executedQty: '0.5', origQty: '0.5', side: 'BUY', time: Date.now() } }) }])
        },
    })

    //T55 未知狀態值
    cases.T55 = () => scenario({
        entry: reset,
        setup: ({ fx, tdid }) => {
            fx.on(K_QUERY, isEntryQuery(tdid), [
                gatePass,
                ...Array.from({ length: 40 }, () => ({ reply: ({ p }) => ({ status: 200, body: { status: 'WEIRD_STATE', orderId: 1, clientOrderId: p.get('origClientOrderId'), executedQty: '0', origQty: '0.007', side: 'BUY', time: Date.now() } }) })),
            ])
        },
    })

    //T12 回查全部失敗
    cases.T12 = () => scenario({
        entry: reset,
        setup: ({ fx, tdid }) => {
            fx.on(K_QUERY, isEntryQuery(tdid), [gatePass, ...Array.from({ length: 40 }, () => ({ reply: 'reset' }))])
        },
    })

    //T53 回查429: 停止輪詢(不等滿視窗)
    cases.T53 = () => scenario({
        entry: reset,
        setup: ({ fx, tdid }) => {
            fx.on(K_QUERY, isEntryQuery(tdid), [gatePass, { reply: { status: 429, body: { code: -1003, msg: 'x' } } }])
        },
    })

    let ordReply = (extra) => ({ reply: ({ p }) => ({ status: 200, body: { status: 'NEW', orderId: 1, clientOrderId: p.get('origClientOrderId'), executedQty: '0', origQty: '0.007', side: 'BUY', time: Date.now(), ...extra } }) })

    //序列: -2013→FILLED; NEW→FILLED; PARTIALLY_FILLED→FILLED(進場已執行)
    let seqCase = (seq) => scenario({
        entry: { exec: true, reply: 'reset' },
        setup: ({ fx, tdid }) => {
            fx.on(K_QUERY, isEntryQuery(tdid), [gatePass, ...seq])
        },
    })
    cases.seqNfFilled = () => seqCase([{ reply: r2013 }])
    cases.seqNewFilled = () => seqCase([ordReply({ status: 'NEW' })])
    cases.seqPartFilled = () => seqCase([ordReply({ status: 'PARTIALLY_FILLED', executedQty: '0.002' })])

    //序列: PARTIALLY_FILLED→EXPIRED(0): 成交量不得倒退
    cases.seqPartExpired = () => scenario({
        entry: reset,
        setup: ({ fx, tdid }) => {
            fx.ex.positions.LONG = 1
            fx.on(K_QUERY, isEntryQuery(tdid), [gatePass, ordReply({ status: 'PARTIALLY_FILLED', executedQty: '0.002' }), ordReply({ status: 'EXPIRED', executedQty: '0' })])
        },
    })

    //序列: 種子部分量後查得他單: 已知量不得遺失
    cases.seedPartMismatch = () => scenario({
        entry: { exec: false, reply: ({ p }) => ({ status: 200, body: { status: 'PARTIALLY_FILLED', orderId: 1, clientOrderId: p.get('newClientOrderId'), executedQty: '0.002', origQty: p.get('quantity'), side: p.get('side'), time: Date.now() } }) },
        setup: ({ fx, tdid }) => {
            fx.ex.positions.LONG = 1
            fx.on(K_QUERY, isEntryQuery(tdid), [gatePass, ordReply({ status: 'FILLED', side: 'SELL', executedQty: '0.007' })])
        },
    })

    //查單回應缺成交量: 不能證明零成交
    cases.queryNoQty = () => scenario({
        entry: reset,
        setup: ({ fx, tdid }) => {
            let body = { status: 'EXPIRED', orderId: 1, clientOrderId: `${tdid}_ENTRY`, origQty: '0.007', side: 'BUY', time: Date.now() }
            fx.on(K_QUERY, isEntryQuery(tdid), [gatePass, ...Array.from({ length: 40 }, () => ({ reply: { status: 200, body } }))])
        },
    })

    //部分成交×止損被拒: ENTERED_PARTIAL_UNKNOWN須帶protectOutcome
    cases.partSlReject = () => scenario({
        entry: reset,
        setup: ({ fx, tdid }) => {
            fx.ex.positions.LONG = 1
            fx.on(K_QUERY, isEntryQuery(tdid), [gatePass, ordReply({ status: 'PARTIALLY_FILLED', executedQty: '0.002' })])
            fx.on(K_ALGO, (p) => p.get('type') === 'STOP_MARKET', [{ reply: { status: 400, body: { code: -2021, msg: 'x' } } }])
        },
    })

    //進場前部位非0且未變: 仍可定論未執行
    cases.posNonZero = () => scenario({
        entry: reset,
        setup: ({ fx }) => {
            fx.ex.positions.LONG = 0.5
        },
    })

    //§5.4 窗後查無之前提: 部位讀取失敗
    cases.posFail = () => scenario({
        entry: reset,
        setup: ({ fx }) => {
            fx.on('GET /fapi/v3/positionRisk', [{ exec: true }, ...Array.from({ length: 5 }, () => ({ reply: 'reset' }))])
        },
    })

    //short亦然
    cases.T08short = () => scenario({ entry: reset, mode: 'short' })

    before(async () => {
        await startFake()
        let names = Object.keys(cases)
        let rs = await Promise.all(names.map((k) => cases[k]()))
        names.forEach((k, i) => {
            results[k] = rs[i]
        })
    })
    after(async () => {
        await stopFake()
        assert.deepStrictEqual(blocked, [], '不得有連外嘗試')
    })

    let assertNoAlgoSingleEntry = (c) => {
        assert.strictEqual(c.fx.count(K_ORDER), 1, 'POST order恰1次')
        assert.strictEqual(c.fx.count(K_ALGO), 0, '無algo')
    }

    it('T08 未送達、查無、部位不變: NOT_ENTERED{entry}, confirmedBy正確; 只於窗後才定論', () => {
        let c = results.T08
        assert.strictEqual(c.err.outcome, 'NOT_ENTERED')
        assert.strictEqual(c.err.execState, 'notExecuted')
        assert.strictEqual(c.err.state.stage, 'entry')
        assert.strictEqual(c.err.state.entry.confirmedBy, 'notFoundAfterWindow+positionUnchanged')
        assertNoAlgoSingleEntry(c)
        //以事件內容斷言下界: 定論前必有窗後(>=6秒)之查詢
        let qs = c.fx.reqsOf(K_QUERY)
        assert.ok(qs.at(-1).t - c.fx.reqsOf(K_ORDER)[0].t >= 6000, `最後查詢距送單 ${qs.at(-1).t - c.fx.reqsOf(K_ORDER)[0].t}`)
        assert.strictEqual(c.rec.ofType('reconcileDone')[0].conclusion, 'notExecuted')
        assert.ok(c.fx.reqsOf('GET /fapi/v3/positionRisk').length >= 2, '進場前快照與窗後交叉')
    })

    it('T08 short: 同樣判定, positionSide為SHORT', () => {
        let c = results.T08short
        assert.strictEqual(c.err.outcome, 'NOT_ENTERED')
        assert.strictEqual(c.fx.reqsOf(K_ORDER)[0].p.positionSide, 'SHORT')
    })

    it('T12 回查全部失敗: ENTRY_UNKNOWN, 無algo, POST order恰1次, 帶tSign、conclusiveAfter、clientOrderId', () => {
        let c = results.T12
        assert.strictEqual(c.err.outcome, 'ENTRY_UNKNOWN')
        assert.strictEqual(c.err.execState, 'unknown')
        assertNoAlgoSingleEntry(c)
        let e = c.err.state.entry
        assert.strictEqual(e.clientOrderId, `${c.tdid}_ENTRY`)
        assert.strictEqual(e.conclusiveAfter, e.tSign + 8000)
    })

    it('T47 -2013→查詢全失敗至deadline: ENTRY_UNKNOWN(無窗後查無)', () => {
        let c = results.T47
        assert.strictEqual(c.err.outcome, 'ENTRY_UNKNOWN')
        assert.strictEqual(c.err.state.entry.reason, 'noNotFoundAfterWindow')
        assertNoAlgoSingleEntry(c)
    })

    it('T48 NEW→-2013至deadline: ENTRY_UNKNOWN(曾見存在)', () => {
        let c = results.T48
        assert.strictEqual(c.err.outcome, 'ENTRY_UNKNOWN')
        assert.strictEqual(c.err.state.entry.reason, 'seenNotFilled')
        assertNoAlgoSingleEntry(c)
    })

    it('T49 RESULT 200帶NEW→-2013: ENTRY_UNKNOWN', () => {
        let c = results.T49
        assert.strictEqual(c.err.outcome, 'ENTRY_UNKNOWN')
        assert.strictEqual(c.err.state.entry.reason, 'seenNotFilled')
        assertNoAlgoSingleEntry(c)
    })

    it('T50 PARTIALLY_FILLED(有量)→-2013: ENTERED_PARTIAL_UNKNOWN, 以已知量掛保護', () => {
        let c = results.T50
        assert.strictEqual(c.err.outcome, 'ENTERED_PARTIAL_UNKNOWN')
        assert.strictEqual(c.err.execState, 'executed')
        assert.strictEqual(c.err.state.entry.maxExecutedQty, '0.002')
        assert.strictEqual(c.fx.count(K_ORDER), 1)
        for (let r of c.fx.reqsOf(K_ALGO)) {
            assert.strictEqual(r.p.quantity, '0.002')
        }
        assert.strictEqual(c.fx.count(K_ALGO), 2)
        assert.deepStrictEqual([c.err.state.sl.status, c.err.state.tp.status, c.err.state.protectOutcome], ['placed', 'placed', null])
    })

    it('T51-1007→一直-2013: ENTRY_UNKNOWN(source:server)', () => {
        let c = results.T51
        assert.strictEqual(c.err.outcome, 'ENTRY_UNKNOWN')
        assert.strictEqual(c.err.state.entry.reason, 'serverReportedUnknown')
        assertNoAlgoSingleEntry(c)
    })

    it('T52 逾時→一直-2013, 部位已變: ENTRY_UNKNOWN', () => {
        let c = results.T52
        assert.strictEqual(c.err.outcome, 'ENTRY_UNKNOWN')
        assert.strictEqual(c.err.state.entry.reason, 'positionChanged')
        assertNoAlgoSingleEntry(c)
    })

    it('§5.4 序列: -2013→FILLED; NEW→FILLED; PARTIALLY_FILLED→FILLED: 皆成功, POST恰1次, 量取FILLED之量', () => {
        for (let k of ['seqNfFilled', 'seqNewFilled', 'seqPartFilled']) {
            let c = results[k]
            assert.ok(c.r, `${k}: ${c.err && c.err.outcome}`)
            assert.deepStrictEqual(c.r.notes, ['entry:reconciled'], k)
            assert.strictEqual(c.r.quantity, '0.007', k)
            assert.strictEqual(c.fx.count(K_ORDER), 1, k)
        }
    })

    it('§5.4 序列: PARTIALLY_FILLED(0.002)→EXPIRED(0): 成交量不得倒退, ENTERED_PARTIAL_UNKNOWN且以已知量掛保護, 不得NOT_ENTERED', () => {
        let c = results.seqPartExpired
        assert.strictEqual(c.err.outcome, 'ENTERED_PARTIAL_UNKNOWN')
        assert.strictEqual(c.err.state.entry.reason, 'executedQtyBackward')
        assert.strictEqual(c.err.state.entry.maxExecutedQty, '0.002')
        for (let r of c.fx.reqsOf(K_ALGO)) {
            assert.strictEqual(r.p.quantity, '0.002')
        }
    })

    it('§5.4 種子已知部分量後查得他單: ENTERED_PARTIAL_UNKNOWN, 已知量不遺失', () => {
        let c = results.seedPartMismatch
        assert.strictEqual(c.err.outcome, 'ENTERED_PARTIAL_UNKNOWN')
        assert.strictEqual(c.err.state.entry.reason, 'identityMismatch')
        assert.strictEqual(c.fx.reqsOf(K_ALGO)[0].p.quantity, '0.002')
    })

    it('§5.4 查單回應缺成交量: 不判0成交, ENTRY_UNKNOWN', () => {
        let c = results.queryNoQty
        assert.strictEqual(c.err.outcome, 'ENTRY_UNKNOWN')
        assert.strictEqual(c.fx.count(K_ALGO), 0)
    })

    it('T50 部分成交×止損被拒: 仍ENTERED_PARTIAL_UNKNOWN, state兩腳如實, protectOutcome明示', () => {
        let c = results.partSlReject
        assert.strictEqual(c.err.outcome, 'ENTERED_PARTIAL_UNKNOWN')
        assert.strictEqual(c.err.state.sl.status, 'notPlaced')
        assert.strictEqual(c.err.state.tp.status, 'placed')
        assert.strictEqual(c.err.state.protectOutcome, 'ENTERED_TP_ONLY')
    })

    it('T08 進場前部位非0且未變: 同樣定論未執行', () => {
        let c = results.posNonZero
        assert.strictEqual(c.err.outcome, 'NOT_ENTERED')
        assert.strictEqual(c.err.state.entry.confirmedBy, 'notFoundAfterWindow+positionUnchanged')
    })

    it('§5.4 窗後部位讀不到: ENTRY_UNKNOWN', () => {
        let c = results.posFail
        assert.strictEqual(c.err.outcome, 'ENTRY_UNKNOWN')
        assert.strictEqual(c.err.state.entry.reason, 'positionUnread')
    })

    it('T53 回查429: 停止輪詢, ENTRY_UNKNOWN(不等滿視窗)', () => {
        let c = results.T53
        assert.strictEqual(c.err.outcome, 'ENTRY_UNKNOWN')
        assert.strictEqual(c.err.state.entry.reason, 'rateLimited')
        assertNoAlgoSingleEntry(c)
        assert.strictEqual(c.fx.reqsOf(K_QUERY).length, 2, '閘1次+回查1次即停')
    })

    it('T54 回查查得舊單(time早、side不同、origQty不同): ENTRY_UNKNOWN, identityMismatch', () => {
        for (let k of ['T54a', 'T54b', 'T54c']) {
            let c = results[k]
            assert.strictEqual(c.err.outcome, 'ENTRY_UNKNOWN', k)
            assert.strictEqual(c.err.state.entry.reason, 'identityMismatch', k)
            assertNoAlgoSingleEntry(c)
        }
    })

    it('T55 未知狀態值: 維持unknown, 無algo', () => {
        let c = results.T55
        assert.strictEqual(c.err.outcome, 'ENTRY_UNKNOWN')
        assertNoAlgoSingleEntry(c)
    })

    it('§5.5 ENTRY_UNKNOWN後同程序同tdid不釋放: 再呼叫TDID_IN_FLIGHT, POST不增加', async () => {
        let c = results.T12
        let n = c.fx.count(K_ORDER)
        let err = await catchErr(webina.opBinaContractMarket(c.fx.st, ott, 'long', c.tdid, 22, 0.04, 0.02, opt))
        assert.strictEqual(err.outcome, 'TDID_IN_FLIGHT')
        assert.strictEqual(c.fx.count(K_ORDER), n)
    })

    it('§5.4 reconcileQuery事件內容: 每次查詢有result, 查得者帶status', () => {
        let c = results.T08
        let qs = c.rec.ofType('reconcileQuery')
        assert.ok(qs.length >= 2)
        for (let q of qs) {
            assert.strictEqual(q.result, 'notFound')
            assert.strictEqual(q.cid, `${c.tdid}_ENTRY`)
        }
        assert.ok(Object.isFrozen(qs[0]))
        //查詢間隔以送出時刻為序, 不斷言恰好幾次
        assert.strictEqual(c.rec.ofType('reconcileDone').length, 1)
    })

})
