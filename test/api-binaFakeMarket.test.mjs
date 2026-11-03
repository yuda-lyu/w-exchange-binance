import assert from 'assert'
import ott from '../src/ott.mjs'
import webina from '../src/WExchangeBinance.mjs'
import { blocked, catchErr, mkFake, mkTraceRec, r2013, startFake, stopFake } from './tools/binaFakeServer.mjs'


//opBinaContractMarket各階段(bx297 §5.5): 全程皆成才回, 其餘依outcome拋; 不重送進場單; 多空皆跑
describe('opBinaContractMarket 各階段 (本機假伺服器)', function() {

    before(async () => {
        await startFake()
    })
    after(async () => {
        await stopFake()
        assert.deepStrictEqual(blocked, [], '不得有連外嘗試')
    })

    let opt = { forceTest: true }
    let K_ORDER = 'POST /fapi/v1/order'
    let K_ALGO = 'POST /fapi/v1/algoOrder'
    let isSl = (p) => p.get('type') === 'STOP_MARKET'
    let isTp = (p) => p.get('type') === 'TAKE_PROFIT_MARKET'
    let nTdid = 0
    let newTdid = () => `tdid-m-${Date.now()}-${++nTdid}`
    let run = (fx, tdid, mode = 'long', o = opt) => webina.opBinaContractMarket(fx.st, ott, mode, tdid, 22, 0.04, 0.02, o)
    let nAlgo = (fx) => fx.count(K_ALGO)
    let rej = (code) => ({ status: 400, body: { code, msg: 'x' } })

    for (let mode of ['long', 'short']) {

        it(`成功路徑(${mode}): 請求序列、RESULT、實際成交量、方向`, async () => {
            let fx = mkFake()
            let tdid = newTdid()
            let r = await run(fx, tdid, mode)
            let keys = fx.reqs.map((x) => x.key)
            assert.strictEqual(keys[0], 'GET /fapi/v1/order', '閘為第一個請求')
            assert.strictEqual(fx.reqsOf('GET /fapi/v1/order')[0].p.origClientOrderId, `${tdid}_ENTRY`)
            assert.ok(keys.indexOf('GET /fapi/v1/premiumIndex') > 0)
            assert.ok(keys.indexOf('GET /fapi/v3/positionRisk') > 0)
            assert.ok(keys.indexOf(K_ORDER) > keys.indexOf('GET /fapi/v1/premiumIndex'))
            assert.strictEqual(fx.count(K_ORDER), 1)
            assert.strictEqual(fx.count(K_ALGO), 2)
            assert.strictEqual(fx.reqsOf(K_ORDER)[0].p.newOrderRespType, 'RESULT')
            assert.strictEqual(fx.reqsOf(K_ORDER)[0].p.positionSide, mode === 'long' ? 'LONG' : 'SHORT')
            assert.strictEqual(fx.reqsOf(K_ORDER)[0].p.side, mode === 'long' ? 'BUY' : 'SELL')
            assert.strictEqual(r.idTrade, tdid)
            assert.strictEqual(r.quantity, fx.reqsOf(K_ORDER)[0].p.quantity)
            assert.deepStrictEqual(r.notes, [])
            assert.strictEqual(r.clientAlgoIdSl, `${tdid}_SL`)
            assert.strictEqual(typeof r.idSl, 'string')
            if (mode === 'long') {
                assert.ok(r.priceTakeProfit > r.priceStart && r.priceStopLoss < r.priceStart)
            }
            else {
                assert.ok(r.priceTakeProfit < r.priceStart && r.priceStopLoss > r.priceStart)
            }
            let slReq = fx.reqsOf(K_ALGO, isSl)[0].p
            assert.strictEqual(slReq.side, mode === 'long' ? 'SELL' : 'BUY')
            assert.strictEqual(slReq.quantity, r.quantity)
            assert.strictEqual(slReq.triggerPrice, String(r.priceStopLoss))
            assert.strictEqual(slReq.workingType, 'MARK_PRICE')
        })

    }

    it('T05 進場POST真實逾時: 只送1次, 進回查', async () => {
        let fx = mkFake()
        fx.on(K_ORDER, [{ exec: true, reply: 'hang' }])
        let r = await run(fx, newTdid())
        assert.strictEqual(fx.count(K_ORDER), 1)
        assert.ok(fx.count('GET /fapi/v1/order') >= 2, '閘1次+回查')
        assert.ok(r.notes.includes('entry:reconciled'))
    })

    it('T07 進場已執行、回應慢、查得FILLED: 成功, notes含reconciled, POST order恰1次, 止損止盈用成交量', async () => {
        let fx = mkFake()
        let tdid = newTdid()
        fx.on(K_ORDER, [{ exec: true, reply: 'reset' }])
        let r = await run(fx, tdid)
        assert.strictEqual(fx.count(K_ORDER), 1)
        assert.deepStrictEqual(r.notes, ['entry:reconciled'])
        assert.strictEqual(nAlgo(fx), 2)
        assert.strictEqual(r.resEntry.clientOrderId, `${tdid}_ENTRY`)
    })

    it('T09 進場-1007(400、408)已執行, 查得FILLED: 走回查, 成功', async () => {
        for (let status of [400, 408]) {
            let fx = mkFake()
            fx.on(K_ORDER, [{ exec: true, reply: { status, body: { code: -1007, msg: 'Timeout waiting for response from backend server.' } } }])
            let r = await run(fx, newTdid())
            assert.strictEqual(fx.count(K_ORDER), 1)
            assert.ok(r.notes.includes('entry:reconciled'), `status ${status}`)
        }
    })

    it('T10 進場503已執行, 查得FILLED: 走回查, 成功', async () => {
        let fx = mkFake()
        fx.on(K_ORDER, [{ exec: true, reply: { status: 503, body: { code: -1000, msg: 'Unknown error' } } }])
        let r = await run(fx, newTdid())
        assert.strictEqual(fx.count(K_ORDER), 1)
        assert.ok(r.notes.includes('entry:reconciled'))
    })

    it('T11 進場-2019: NOT_ENTERED, 不查單不掛保護', async () => {
        let fx = mkFake()
        fx.on(K_ORDER, [{ reply: rej(-2019) }])
        let err = await catchErr(run(fx, newTdid()))
        assert.strictEqual(err.outcome, 'NOT_ENTERED')
        assert.strictEqual(err.execState, 'notExecuted')
        assert.strictEqual(err.state.stage, 'entry')
        assert.strictEqual(err.binance.code, -2019)
        assert.strictEqual(fx.count('GET /fapi/v1/order'), 1, '只有閘')
        assert.strictEqual(nAlgo(fx), 0)
    })

    it('T13 RESULT回NEW後查得EXPIRED 0成交: NOT_ENTERED, 無algo, 請求帶RESULT(修前回成功且掛止損止盈)', async () => {
        let fx = mkFake()
        let tdid = newTdid()
        fx.on(K_ORDER, [{
            exec: false,
            reply: ({ ex, p }) => {
                let o = ex.addOrder({ clientOrderId: p.get('newClientOrderId'), origQty: p.get('quantity'), executedQty: '0.000', status: 'NEW', side: p.get('side'), positionSide: p.get('positionSide') })
                setTimeout(() => {
                    o.status = 'EXPIRED'
                }, 50)
                return { status: 200, body: { ...o } }
            },
        }])
        let err = await catchErr(run(fx, tdid))
        assert.strictEqual(err.outcome, 'NOT_ENTERED')
        assert.strictEqual(err.state.stage, 'entry')
        assert.strictEqual(err.state.entry.confirmedBy, 'terminal:EXPIRED')
        assert.strictEqual(nAlgo(fx), 0)
        assert.strictEqual(fx.reqsOf(K_ORDER)[0].p.newOrderRespType, 'RESULT')
    })

    it('T14 部分成交(終局帶量): 止損止盈與回傳quantity皆用executedQty, uTradeReal以成交量計(修前用原數量)', async () => {
        let fx = mkFake()
        fx.on(K_ORDER, [{
            exec: false,
            reply: ({ ex, p }) => {
                let o = ex.addOrder({ clientOrderId: p.get('newClientOrderId'), origQty: p.get('quantity'), executedQty: '0.003', status: 'EXPIRED', side: p.get('side'), positionSide: p.get('positionSide') })
                ex.addPos(p.get('positionSide'), 0.003)
                return { status: 200, body: { ...o } }
            },
        }])
        let r = await run(fx, newTdid())
        assert.strictEqual(r.quantity, '0.003')
        assert.strictEqual(fx.reqsOf(K_ALGO, isSl)[0].p.quantity, '0.003')
        assert.strictEqual(fx.reqsOf(K_ALGO, isTp)[0].p.quantity, '0.003')
        assert.strictEqual(Number(r.uTradeReal), 9)
    })

    it('T15 進場200無orderId、executedQty非數字、clientOrderId不符: 不直接掛, 走回查(修前掛止損止盈後拋invalid resEntry.orderId)', async () => {
        for (let bad of [(o) => ({ ...o, orderId: undefined }), (o) => ({ ...o, executedQty: 'abc' }), (o) => ({ ...o, clientOrderId: 'other' })]) {
            let fx = mkFake()
            fx.on(K_ORDER, [{ exec: true, reply: (ctx, out) => ({ status: 200, body: bad(out.body) }) }])
            let r = await run(fx, newTdid())
            assert.strictEqual(fx.count(K_ORDER), 1)
            assert.ok(r.notes.includes('entry:reconciled'))
            assert.ok(fx.count('GET /fapi/v1/order') >= 2)
        }
    })

    it('T22 同tdid第2次: TDID_USED, state三腳, POST order 0次(修前第2次進場被送而部位加倍)', async () => {
        let fx = mkFake()
        let tdid = newTdid()
        await run(fx, tdid)
        let n1 = fx.count(K_ORDER)
        let err = await catchErr(run(fx, tdid))
        assert.strictEqual(err.outcome, 'TDID_USED')
        assert.strictEqual(err.execState, 'unknown', '前次可能已成交, 不得回notExecuted誘使換新ID重下')
        assert.strictEqual(err.state.sentThisCall, false)
        assert.strictEqual(fx.count(K_ORDER), n1)
        assert.strictEqual(err.state.entry.res.found, true)
        assert.strictEqual(err.state.sl.status, 'found')
        assert.strictEqual(err.state.tp.status, 'found')
        assert.strictEqual(typeof err.state.sl.algoId, 'string')
    })

    it('T22 重啟情境: 前次進場已成交而保護單未掛: TDID_USED且兩腳status如實(未見、查詢失敗皆不得標found)', async () => {
        let fx = mkFake()
        let tdid = newTdid()
        fx.ex.addOrder({ clientOrderId: `${tdid}_ENTRY` })
        let err = await catchErr(run(fx, tdid))
        assert.strictEqual(err.outcome, 'TDID_USED')
        assert.deepStrictEqual([err.state.sl.status, err.state.sl.algoId], ['notObserved', null])
        assert.deepStrictEqual([err.state.tp.status, err.state.tp.algoId], ['notObserved', null])
        assert.strictEqual(fx.count(K_ORDER), 0)

        let fx2 = mkFake()
        let tdid2 = newTdid()
        fx2.ex.addOrder({ clientOrderId: `${tdid2}_ENTRY` })
        fx2.on('GET /fapi/v1/openAlgoOrders', Array.from({ length: 6 }, () => ({ reply: 'reset' })))
        let err2 = await catchErr(run(fx2, tdid2))
        assert.deepStrictEqual([err2.state.sl.status, err2.state.tp.status], ['unknown', 'unknown'])
    })

    it('T22 進場回-4116: TDID_USED, 不回查不掛', async () => {
        let fx = mkFake()
        fx.on(K_ORDER, [{ reply: { status: 400, body: { code: -4116, msg: 'dup' } } }])
        let err = await catchErr(run(fx, newTdid()))
        assert.strictEqual(err.outcome, 'TDID_USED')
        assert.strictEqual(err.execState, 'unknown')
        assert.strictEqual(nAlgo(fx), 0)
        assert.strictEqual(fx.count('GET /fapi/v1/order'), 1, '只有閘, 不回查')
    })

    it('§5.2 進場POST收到只適用他站之-2011、-4046、-4059: 不得判NOT_ENTERED, 走回查', async () => {
        for (let code of [-2011, -4046, -4059]) {
            let fx = mkFake()
            fx.on(K_ORDER, [{ exec: true, reply: rej(code) }])
            let r = await run(fx, newTdid())
            assert.ok(r.notes.includes('entry:reconciled'), `code ${code}`)
            assert.strictEqual(fx.count(K_ORDER), 1)
        }
    })

    it('T23 tdid 31字元、含空白、含底線、BigInt: 入口拋錯, 請求0次', async () => {
        let fx = mkFake()
        for (let tdid of ['a'.repeat(31), 'a b', 'a_b', '', null, 123, 'a!', BigInt(1)]) {
            let err = await catchErr(run(fx, tdid))
            assert.match(err.message, /invalid tdid/)
        }
        assert.strictEqual(fx.reqs.length, 0)
        let fx2 = mkFake()
        await run(fx2, 'a'.repeat(30))
        assert.strictEqual(fx2.count(K_ORDER), 1, '30字元可')
    })

    it('V17 全部參數檢測先於請求, 訊息不回顯值(V20)', async () => {
        let fx = mkFake()
        let bad = [
            () => webina.opBinaContractMarket(fx.st, null, 'long', 'td', 22, 0.04, 0.02, opt),
            () => webina.opBinaContractMarket(fx.st, ott, 'x-mode-x', 'td', 22, 0.04, 0.02, opt),
            () => webina.opBinaContractMarket(fx.st, ott, 'long', 'td', 'abc-val', 0.04, 0.02, opt),
            () => webina.opBinaContractMarket(fx.st, ott, 'long', 'td', 1, 0.04, 0.02, opt),
            () => webina.opBinaContractMarket(fx.st, ott, 'long', 'td', 22, 0.3, 0.02, opt),
            () => webina.opBinaContractMarket(fx.st, ott, 'long', 'td', 22, 0, 0.02, opt),
            () => webina.opBinaContractMarket(fx.st, ott, 'long', 'td', 22, 0.04, 0.2, opt),
            () => webina.opBinaContractMarket(fx.st, ott, 'long', 'td', 22, 0.04, 'NaN', opt),
            () => webina.opBinaContractMarket(fx.st, ott, 'long', 'td', Infinity, 0.04, 0.02, opt),
        ]
        for (let fn of bad) {
            let err = await catchErr(fn())
            assert.match(err.message, /^invalid /)
            assert.ok(!/x-mode-x|abc-val/.test(err.message))
        }
        assert.strictEqual(fx.reqs.length, 0)
    })

    it('T24 tdid_ENTRY查單失敗: NOT_ENTERED{precheck}, POST order 0次', async () => {
        let fx = mkFake()
        fx.on('GET /fapi/v1/order', Array.from({ length: 3 }, () => ({ reply: 'reset' })))
        let err = await catchErr(run(fx, newTdid()))
        assert.strictEqual(err.outcome, 'NOT_ENTERED')
        assert.strictEqual(err.state.stage, 'precheck')
        assert.strictEqual(fx.count(K_ORDER), 0)
    })

    it('T61 同程序並行同tdid: 第2個TDID_IN_FLIGHT, POST order恰1次', async () => {
        let fx = mkFake()
        let tdid = newTdid()
        let [a, b] = await Promise.allSettled([run(fx, tdid), run(fx, tdid)])
        assert.strictEqual(a.status, 'fulfilled')
        assert.strictEqual(b.status, 'rejected')
        assert.strictEqual(b.reason.outcome, 'TDID_IN_FLIGHT')
        assert.strictEqual(b.reason.execState, 'unknown')
        assert.strictEqual(b.reason.state.sentThisCall, false)
        assert.strictEqual(b.reason.state.previous.tdid, tdid, '帶前次狀態')
        assert.strictEqual(fx.count(K_ORDER), 1)
    })

    it('T61 Market與MarketEntry並行同一進場ID: 共用在途防護, POST order恰1次', async () => {
        let fx = mkFake()
        let tdid = newTdid()
        let [a, b] = await Promise.allSettled([run(fx, tdid), webina.opBinaContractMarketEntry(fx.st, 'ETHUSDT', 'BUY', 'LONG', 0.007, { ...opt, clientOrderId: `${tdid}_ENTRY` })])
        assert.strictEqual(a.status, 'fulfilled')
        assert.strictEqual(b.status, 'rejected')
        assert.strictEqual(b.reason.outcome, 'ID_USED')
        assert.strictEqual(b.reason.state.reason, 'inFlight')
        assert.strictEqual(fx.count(K_ORDER), 1)
    })

    it('T61 同一操作確定被拒且未留單後: 在途已釋放, 同tdid可再呼叫(閘未見單)', async () => {
        let fx = mkFake()
        let tdid = newTdid()
        fx.on(K_ORDER, [{ reply: rej(-2019) }])
        await catchErr(run(fx, tdid))
        let r = await run(fx, tdid)
        assert.strictEqual(r.idTrade, tdid)
    })

    it('T62 entryDeadlineMs已過: NOT_ENTERED{deadline}, POST 0次; 非預期值視為未給', async () => {
        let fx = mkFake()
        let err = await catchErr(run(fx, newTdid(), 'long', { ...opt, entryDeadlineMs: 0.001 }))
        assert.strictEqual(err.outcome, 'NOT_ENTERED')
        assert.strictEqual(err.state.stage, 'deadline')
        assert.strictEqual(fx.count(K_ORDER), 0)
        let fx2 = mkFake()
        await run(fx2, newTdid(), 'long', { ...opt, entryDeadlineMs: 'abc' })
        assert.strictEqual(fx2.count(K_ORDER), 1)
    })

    it('T63 帳戶設定POST未知: NOT_ENTERED{setup}, state.setup, 順序在閘之後', async () => {
        let fx = mkFake()
        fx.on('POST /fapi/v1/leverage', [{ reply: 'reset' }])
        let err = await catchErr(run(fx, newTdid(), 'long', { ...opt, setLever: true }))
        assert.strictEqual(err.outcome, 'NOT_ENTERED')
        assert.strictEqual(err.state.stage, 'setup')
        assert.strictEqual(err.state.setup.lever, 'unknown')
        assert.strictEqual(fx.count(K_ORDER), 0)
        let keys = fx.reqs.map((x) => x.key)
        assert.ok(keys.indexOf('GET /fapi/v1/order') < keys.indexOf('POST /fapi/v1/leverage'))
    })

    it('§5.5 帳戶設定以-4046、-4059判無須變更, 不比對字串', async () => {
        let fx = mkFake()
        fx.on('POST /fapi/v1/marginType', [{ reply: { status: 400, body: { code: -4046, msg: 'whatever text' } } }])
        fx.on('POST /fapi/v1/positionSide/dual', [{ reply: { status: 400, body: { code: -4059, msg: 'whatever text' } } }])
        let r = await run(fx, newTdid(), 'long', { ...opt, setCrossMargin: true, setDualSide: true, setLever: true })
        assert.strictEqual(r.notes.length, 0)
        let fx2 = mkFake()
        fx2.on('POST /fapi/v1/marginType', [{ reply: { status: 400, body: { code: -1234, msg: 'No need to change margin type.' } } }])
        let err = await catchErr(run(fx2, newTdid(), 'long', { ...opt, setCrossMargin: true }))
        assert.strictEqual(err.state.stage, 'setup', '含字樣而代碼不符不得當無須變更')
    })

    it('§5.5 標記價讀不到: NOT_ENTERED{mark}; 名義或最小量不足: NOT_ENTERED{mark}, 皆不送單', async () => {
        let fx = mkFake()
        fx.on('GET /fapi/v1/premiumIndex', Array.from({ length: 3 }, () => ({ reply: { status: 200, body: { symbol: 'ETHUSDT', markPrice: 'x' } } })))
        let err = await catchErr(run(fx, newTdid()))
        assert.deepStrictEqual([err.outcome, err.state.stage], ['NOT_ENTERED', 'mark'])
        assert.strictEqual(fx.count(K_ORDER), 0)
        let fx2 = mkFake({ quantityLow: 1 })
        let err2 = await catchErr(run(fx2, newTdid()))
        assert.deepStrictEqual([err2.outcome, err2.state.stage], ['NOT_ENTERED', 'mark'])
        assert.strictEqual(fx2.count(K_ORDER), 0)
    })

    //SL×TP outcome全表; 未知終局: 送失敗→open無→queryAlgo得未列舉狀態→終局unknown
    let setLeg = (fx, kind, filter) => {
        let isLeg = (p) => String(p.get('clientAlgoId')).endsWith(filter === isSl ? '_SL' : '_TP')
        if (kind === 'notPlaced') {
            fx.on(K_ALGO, filter, [{ reply: rej(-2022) }])
        }
        if (kind === 'unknown') {
            fx.on(K_ALGO, filter, [{ reply: 'reset' }])
            fx.on('GET /fapi/v1/algoOrder', isLeg, [{ reply: () => ({ status: 200, body: { algoStatus: 'WEIRD', createTime: Date.now() } }) }])
        }
        if (kind === 'triggered') {
            fx.on(K_ALGO, filter, [{ reply: 'reset' }])
            fx.on('GET /fapi/v1/algoOrder', isLeg, [{ reply: () => ({ status: 200, body: { algoStatus: 'FINISHED', createTime: Date.now() } }) }])
        }
    }
    let table = [
        ['placed', 'placed', null],
        ['placed', 'notPlaced', 'ENTERED_SL_ONLY'],
        ['placed', 'unknown', 'ENTERED_SL_ONLY'],
        ['placed', 'triggered', 'ENTERED_POSITION_CHANGED'],
        ['notPlaced', 'placed', 'ENTERED_TP_ONLY'],
        ['notPlaced', 'notPlaced', 'ENTERED_UNPROTECTED'],
        ['notPlaced', 'unknown', 'ENTERED_PROTECTION_UNKNOWN'],
        ['notPlaced', 'triggered', 'ENTERED_POSITION_CHANGED'],
        ['unknown', 'placed', 'ENTERED_PROTECTION_UNKNOWN'],
        ['unknown', 'notPlaced', 'ENTERED_PROTECTION_UNKNOWN'],
        ['unknown', 'unknown', 'ENTERED_PROTECTION_UNKNOWN'],
        ['unknown', 'triggered', 'ENTERED_POSITION_CHANGED'],
    ]
    for (let mode of ['long', 'short']) {
        let sideClose = mode === 'long' ? 'SELL' : 'BUY'
        for (let [sl, tp, outcome] of table) {
            it(`T60 兩腳全表(${mode}) SL=${sl} TP=${tp} → ${outcome || '成功回傳'}`, async () => {
                let fx = mkFake()
                setLeg(fx, sl, isSl)
                setLeg(fx, tp, isTp)
                if (outcome === null) {
                    let r = await run(fx, newTdid(), mode)
                    assert.strictEqual(typeof r.idSl, 'string')
                    return
                }
                let err = await catchErr(run(fx, newTdid(), mode))
                assert.strictEqual(err.outcome, outcome)
                assert.strictEqual(err.execState, 'executed')
                assert.strictEqual(err.state.entry.status, 'filled')
                assert.strictEqual(err.state.sl.status, sl)
                assert.strictEqual(err.state.tp.status, tp)
                assert.strictEqual(fx.count(K_ORDER), 1)
                //§9一A: 不自動平倉
                assert.strictEqual(fx.reqsOf(K_ORDER, (p) => p.get('side') === sideClose).length, 0)
            })
        }

        it(`T60 SL triggered(${mode}): 止盈不送, ENTERED_POSITION_CHANGED`, async () => {
            let fx = mkFake()
            setLeg(fx, 'triggered', isSl)
            let err = await catchErr(run(fx, newTdid(), mode))
            assert.strictEqual(err.outcome, 'ENTERED_POSITION_CHANGED')
            assert.strictEqual(err.state.sl.status, 'triggered')
            assert.strictEqual(err.state.tp.status, 'notSent')
            assert.strictEqual(fx.count(K_ALGO, isTp), 0)
        })

        it(`T17 止損未送達(${mode}): 同ID重送成功, 部位以帶號與進場後應有量比較`, async () => {
            let fx = mkFake()
            fx.on(K_ALGO, isSl, [{ exec: false, reply: 'reset' }])
            let r = await run(fx, newTdid(), mode)
            assert.strictEqual(fx.count(K_ALGO, isSl), 2)
            assert.strictEqual(typeof r.idSl, 'string')
        })
    }

    it('T46 §5.5 共用部位: 重送前部位少於進場後應有量即不重送(他tdid部位不得掩蓋已觸發)', async () => {
        let fx = mkFake()
        fx.ex.positions.LONG = 0.007
        fx.on(K_ALGO, isSl, [{
            exec: false,
            reply: 'reset',
            before: ({ ex }) => {
                ex.positions.LONG = 0.007 //進場後應為0.014, 只剩0.007: 本腳可能已觸發
            }
        }])
        let err = await catchErr(run(fx, newTdid()))
        assert.strictEqual(err.state.sl.status, 'unknown')
        assert.strictEqual(err.state.sl.reason, 'positionInsufficient')
        assert.strictEqual(fx.count(K_ALGO, isSl), 1)
    })

    it('§5.5 成功回傳之進場時間函數失敗不影響結果: timeStart留空, notes標明', async () => {
        let fx = mkFake()
        let r = await webina.opBinaContractMarket(fx.st, () => {
            throw new Error('ott-fail')
        }, 'long', newTdid(), 22, 0.04, 0.02, opt)
        assert.strictEqual(r.timeStart, '')
        assert.ok(r.notes.includes('timeStart:formatFailed'))
    })

    it('T46 止損未知、open無、queryAlgoOrder得FINISHED: 不重送, sl triggered, 止盈不送', async () => {
        let fx = mkFake()
        let tdid = newTdid()
        fx.on(K_ALGO, isSl, [{ reply: 'reset' }])
        fx.on('GET /fapi/v1/algoOrder', [{ reply: r2013 }, { reply: () => ({ status: 200, body: { algoStatus: 'FINISHED', clientAlgoId: `${tdid}_SL`, createTime: Date.now() } }) }])
        let err = await catchErr(run(fx, tdid))
        assert.strictEqual(err.outcome, 'ENTERED_POSITION_CHANGED')
        assert.strictEqual(err.state.sl.status, 'triggered')
        assert.strictEqual(fx.count(K_ALGO, isSl), 1, '不重送')
        assert.strictEqual(fx.count(K_ALGO, isTp), 0)
    })

    it('T16 止損已掛、回應慢: open查得, 止盈續送, 成功, 該ID POST恰1次(修前NetworkError且止盈不送)', async () => {
        let fx = mkFake()
        fx.on(K_ALGO, isSl, [{ exec: true, reply: 'reset' }])
        let r = await run(fx, newTdid())
        assert.strictEqual(fx.count(K_ALGO, isSl), 1)
        assert.strictEqual(fx.count(K_ALGO, isTp), 1)
        assert.strictEqual(typeof r.idSl, 'string')
    })

    it('T18 止損-2021: 仍試止盈, ENTERED_TP_ONLY, sl.reason=immediateTrigger(修前拋且止盈不送)', async () => {
        let fx = mkFake()
        fx.on(K_ALGO, isSl, [{ reply: rej(-2021) }])
        let err = await catchErr(run(fx, newTdid()))
        assert.strictEqual(err.outcome, 'ENTERED_TP_ONLY')
        assert.strictEqual(err.state.sl.reason, 'immediateTrigger')
        assert.strictEqual(fx.count(K_ALGO, isSl), 1)
        assert.strictEqual(fx.count(K_ALGO, isTp), 1)
    })

    it('T19 止損送3次皆未知: ENTERED_PROTECTION_UNKNOWN, 不平倉, 帶conclusiveAfter', async () => {
        let fx = mkFake()
        fx.ex.positions.LONG = 1
        fx.on(K_ALGO, isSl, Array.from({ length: 5 }, () => ({ reply: 'reset' })))
        let err = await catchErr(run(fx, newTdid()))
        assert.strictEqual(err.outcome, 'ENTERED_PROTECTION_UNKNOWN')
        assert.strictEqual(err.state.sl.status, 'unknown')
        assert.strictEqual(err.state.sl.reason, 'sendsExhausted')
        assert.strictEqual(fx.count(K_ALGO, isSl), 3)
        assert.strictEqual(err.state.sl.conclusiveAfter, err.state.sl.tSign + 6000)
        assert.strictEqual(fx.reqsOf(K_ORDER, (p) => p.get('side') === 'SELL').length, 0)
    })

    it('T20 止盈失敗: ENTERED_SL_ONLY, state.sl帶已掛(修前拋, resSl有)', async () => {
        let fx = mkFake()
        fx.on(K_ALGO, isTp, [{ reply: rej(-2021) }])
        let err = await catchErr(run(fx, newTdid()))
        assert.strictEqual(err.outcome, 'ENTERED_SL_ONLY')
        assert.strictEqual(err.state.sl.status, 'placed')
        assert.strictEqual(typeof err.state.sl.algoId, 'string')
    })

    it('T21 止損429一次: 等待後重送成功(修前拋)', async () => {
        let fx = mkFake()
        fx.on(K_ALGO, isSl, [{ reply: { status: 429, body: { code: -1015, msg: 'Too many new orders.' } } }])
        let r = await run(fx, newTdid())
        assert.strictEqual(fx.count(K_ALGO, isSl), 2)
        assert.strictEqual(typeof r.idSl, 'string')
        let rows = fx.reqsOf(K_ALGO, isSl)
        assert.ok(rows[1].t - rows[0].t >= 950, `間隔 ${rows[1].t - rows[0].t}`)
    })

    it('T43 回查與保護單之觀察回調: 五種回調案結果相同; 事件凍結、this為undefined', async () => {
        let unhandled = []
        let onUnhandled = (e) => unhandled.push(e)
        process.on('unhandledRejection', onUnhandled)
        try {
            let rec = mkTraceRec()
            let thisVals = []
            let modes = [
                {},
                {
                    onTrace: function(e) {
                        thisVals.push(this)
                        rec.onTrace(e)
                    },
                },
                {
                    onTrace: () => {
                        throw new Error('cb')
                    },
                },
                { onTrace: () => Promise.reject(new Error('cb')) },
                { onTrace: 'x' },
            ]
            let results = []
            for (let m of modes) {
                let fx = mkFake()
                fx.on(K_ORDER, [{ exec: true, reply: 'reset' }])
                fx.on(K_ALGO, isSl, [{ exec: true, reply: 'reset' }])
                let r = await run(fx, newTdid(), 'long', { ...opt, ...m })
                results.push({ notes: r.notes, nOrder: fx.count(K_ORDER), nAlgo: fx.count(K_ALGO), q: r.quantity })
            }
            await new Promise((resolve) => setImmediate(resolve))
            for (let x of results) {
                assert.deepStrictEqual(x, results[0])
            }
            assert.deepStrictEqual(unhandled, [])
            let q = rec.ofType('reconcileQuery')[0]
            assert.deepStrictEqual([q.result, q.status], ['found', 'FILLED'])
            assert.strictEqual(rec.ofType('reconcileDone')[0].conclusion, 'filled')
            assert.ok(rec.ofType('protectSend').length >= 2)
            assert.ok(Object.isFrozen(q))
            assert.ok(thisVals.length > 0)
            for (let v of thisVals) {
                assert.strictEqual(v, undefined)
            }
            for (let e of rec.evs) {
                for (let k of Object.keys(e)) {
                    assert.ok(e[k] === null || ['string', 'number', 'boolean'].includes(typeof e[k]), `${e.type}.${k}只放原始值`)
                }
            }
        }
        finally {
            process.off('unhandledRejection', onUnhandled)
        }
    })

    it('§5.4 RESULT回FILLED而executedQty為0: 不得當成交掛保護, 走回查', async () => {
        let fx = mkFake()
        fx.on(K_ORDER, [{ exec: true, reply: (ctx, out) => ({ status: 200, body: { ...out.body, executedQty: '0.000' } }) }])
        let r = await run(fx, newTdid())
        assert.ok(r.notes.includes('entry:reconciled'))
        assert.ok(Number(r.quantity) > 0)
    })

    it('錯誤與日誌不含金鑰: 序列化與inspect皆無secret; 函式庫不console.log', async () => {
        let fx = mkFake()
        fx.on(K_ORDER, [{ reply: rej(-2019) }])
        let logs = []
        let orig = console.log
        console.log = (...a) => logs.push(a)
        let err
        try {
            err = await catchErr(run(fx, newTdid()))
        }
        finally {
            console.log = orig
        }
        assert.deepStrictEqual(logs, [])
        let util = await import('util')
        let s = `${JSON.stringify(err.state)} ${JSON.stringify(err.binance)} ${util.inspect(err, { depth: 8 })} ${err.stack}`
        assert.ok(!s.includes('fake-secret'), '不得含secret')
        assert.ok(!s.includes(fx.st.binance.apiContractTest.key), '不得含key')
    })

})
