import assert from 'assert'
import webina from '../src/WExchangeBinance.mjs'
import { blocked, catchErr, mkFake, startFake, stopFake } from './tools/binaFakeServer.mjs'


//opBinaContractMarketEntry(bx297 §5.9; T25、T67、T68)
describe('opBinaContractMarketEntry (本機假伺服器)', function() {
    this.timeout(180000)

    before(async () => {
        await startFake()
    })
    after(async () => {
        await stopFake()
        assert.deepStrictEqual(blocked, [], '不得有連外嘗試')
    })

    let opt = { forceTest: true }
    let K_ORDER = 'POST /fapi/v1/order'
    let run = (fx, o = opt, symbol = 'ETHUSDT') => webina.opBinaContractMarketEntry(fx.st, symbol, 'SELL', 'LONG', 0.007, o)

    it('正常: 自產ID合乎幣安格式、RESULT、部位快照先於下單、回傳成交單', async () => {
        let fx = mkFake()
        fx.ex.positions.LONG = 1
        let r = await run(fx)
        let req = fx.reqsOf(K_ORDER)[0].p
        assert.match(req.newClientOrderId, /^[.A-Z:/a-z0-9_-]{1,36}$/)
        assert.strictEqual(req.newOrderRespType, 'RESULT')
        assert.strictEqual(r.clientOrderId, req.newClientOrderId)
        assert.strictEqual(r.status, 'FILLED')
        assert.deepStrictEqual(r.notes, [])
        assert.strictEqual(fx.count('GET /fapi/v1/order'), 0, '自產ID不過閘')
        let keys = fx.reqs.map((x) => x.key)
        assert.ok(keys.indexOf('GET /fapi/v3/positionRisk') < keys.indexOf(K_ORDER))
    })

    it('T25 逾時回查FILLED: 回成功, POST恰1次(修前無ID、NetworkError)', async () => {
        let fx = mkFake()
        fx.on(K_ORDER, [{ exec: true, reply: 'reset' }])
        let r = await run(fx)
        assert.strictEqual(fx.count(K_ORDER), 1)
        assert.deepStrictEqual(r.notes, ['entry:reconciled'])
        assert.strictEqual(r.status, 'FILLED')
    })

    it('T67 SYMBOL不同於st.symbol; 未知: 回查與部位用實際SYMBOL', async () => {
        let fx = mkFake()
        fx.on(K_ORDER, [{ exec: true, reply: 'reset' }])
        let r = await webina.opBinaContractMarketEntry(fx.st, 'BTCUSDT', 'BUY', 'LONG', 0.007, opt)
        assert.strictEqual(r.status, 'FILLED')
        assert.strictEqual(fx.reqsOf(K_ORDER)[0].p.symbol, 'BTCUSDT')
        assert.strictEqual(fx.reqsOf('GET /fapi/v1/order')[0].p.symbol, 'BTCUSDT')
        assert.strictEqual(fx.reqsOf('GET /fapi/v3/positionRisk')[0].p.symbol, 'BTCUSDT')
    })

    it('T68 呼叫端給已用ID: ID_USED, POST 0次(修前送出)', async () => {
        let fx = mkFake()
        fx.ex.addOrder({ clientOrderId: 'used-1' })
        let err = await catchErr(run(fx, { ...opt, clientOrderId: 'used-1' }))
        assert.strictEqual(err.outcome, 'ID_USED')
        assert.strictEqual(err.state.clientOrderId, 'used-1')
        assert.strictEqual(fx.count(K_ORDER), 0)
    })

    it('T68 呼叫端給未用ID: 過閘後以該ID送; 閘查詢失敗不送; 給了而格式無效即拋(靜默換ID會讓去重失效), 請求0次', async () => {
        let fx = mkFake()
        let r = await run(fx, { ...opt, clientOrderId: 'free-1' })
        assert.strictEqual(r.clientOrderId, 'free-1')
        assert.strictEqual(fx.count('GET /fapi/v1/order'), 1)

        let fx2 = mkFake()
        fx2.on('GET /fapi/v1/order', Array.from({ length: 3 }, () => ({ reply: 'reset' })))
        let err = await catchErr(run(fx2, { ...opt, clientOrderId: 'free-2' }))
        assert.deepStrictEqual([err.outcome, err.state.stage, err.execState], ['NOT_EXECUTED', 'precheck', 'notExecuted'])
        assert.strictEqual(err.state.precheck.errKind, 'UNKNOWN')
        assert.strictEqual(fx2.count(K_ORDER), 0)

        let fx3 = mkFake()
        for (let bad of ['bad id!', 'x'.repeat(37), '', 123, BigInt(1), {}]) {
            let err3 = await catchErr(run(fx3, { ...opt, clientOrderId: bad }))
            assert.match(err3.message, /^invalid opt\.clientOrderId/)
            assert.ok(!err3.message.includes('bad id!'))
        }
        assert.strictEqual(fx3.reqs.length, 0)
        let r3b = await run(fx3, { ...opt, clientOrderId: null })
        assert.match(r3b.clientOrderId, /^me-/, 'null視為未給')
    })

    it('T67 對稱: SHORT、BOTH之回查與部位用實際positionSide, side比對用實際side', async () => {
        for (let [side, positionSide] of [['BUY', 'SHORT'], ['SELL', 'BOTH']]) {
            let fx = mkFake()
            fx.on(K_ORDER, [{ exec: true, reply: 'reset' }])
            let r = await webina.opBinaContractMarketEntry(fx.st, 'ETHUSDT', side, positionSide, 0.007, opt)
            assert.strictEqual(r.status, 'FILLED')
            assert.strictEqual(fx.reqsOf(K_ORDER)[0].p.positionSide, positionSide)
            assert.deepStrictEqual(r.notes, ['entry:reconciled'])
        }
    })

    it('T68 同程序並行同ID: 第2個ID_USED(inFlight), POST恰1次; 確定被拒後釋放', async () => {
        let fx = mkFake()
        let [a, b] = await Promise.allSettled([run(fx, { ...opt, clientOrderId: 'par-1' }), run(fx, { ...opt, clientOrderId: 'par-1' })])
        assert.strictEqual(a.status, 'fulfilled')
        assert.strictEqual(b.reason.outcome, 'ID_USED')
        assert.strictEqual(b.reason.state.reason, 'inFlight')
        assert.strictEqual(fx.count(K_ORDER), 1)

        let fx2 = mkFake()
        fx2.on(K_ORDER, [{ reply: { status: 400, body: { code: -4164, msg: 'x' } } }])
        let err = await catchErr(run(fx2, { ...opt, clientOrderId: 'par-2' }))
        assert.strictEqual(err.outcome, 'NOT_EXECUTED')
        let r = await run(fx2, { ...opt, clientOrderId: 'par-2' })
        assert.strictEqual(r.status, 'FILLED')
    })

    it('§5.9 確定被拒: NOT_EXECUTED, err.state.clientOrderId必帶, 不查單', async () => {
        let fx = mkFake()
        fx.on(K_ORDER, [{ reply: { status: 400, body: { code: -4164, msg: 'x' } } }])
        let err = await catchErr(run(fx))
        assert.strictEqual(err.outcome, 'NOT_EXECUTED')
        assert.strictEqual(err.execState, 'notExecuted')
        assert.strictEqual(err.state.clientOrderId, fx.reqsOf(K_ORDER)[0].p.newClientOrderId)
        assert.strictEqual(fx.count('GET /fapi/v1/order'), 0)
    })

    it('§5.9 部位快照讀不到: 照送(緊急平倉不得因讀取失敗而不送), 成交照回', async () => {
        let fx = mkFake()
        fx.on('GET /fapi/v3/positionRisk', Array.from({ length: 3 }, () => ({ reply: 'reset' })))
        let r = await run(fx)
        assert.strictEqual(r.status, 'FILLED')
        assert.strictEqual(fx.count(K_ORDER), 1)
    })

    it('§5.9 -4116: ID_USED, execState未知(前次可能已成交), 本次未送單', async () => {
        let fx = mkFake()
        fx.on(K_ORDER, [{ reply: { status: 400, body: { code: -4116, msg: 'x' } } }])
        let err = await catchErr(run(fx))
        assert.deepStrictEqual([err.outcome, err.execState, err.state.sentThisCall], ['ID_USED', 'unknown', false])
    })

    it('入口參數無效拋錯, 請求0次', async () => {
        let fx = mkFake()
        let bad = [
            ['', 'BUY', 'LONG', 1],
            ['ETHUSDT', 'x', 'LONG', 1],
            ['ETHUSDT', 'BUY', 'x', 1],
            ['ETHUSDT', 'BUY', 'LONG', 0],
            ['ETHUSDT', 'BUY', 'LONG', 'x'],
            ['ETHUSDT', 'BUY', 'LONG', Infinity],
        ]
        for (let a of bad) {
            await catchErr(webina.opBinaContractMarketEntry(fx.st, ...a, opt))
        }
        assert.strictEqual(fx.reqs.length, 0)
    })

    describe('真實視窗約8秒', function() {

        let results = {}
        let nm = 0
        let cases = {
            notExecuted: (fx) => fx.on(K_ORDER, [{ exec: false, reply: 'reset' }]),
            server: (fx) => fx.on(K_ORDER, [{ exec: false, reply: { status: 503, body: '' } }]),
            positionChanged: (fx) => {
                fx.on(K_ORDER, [{ exec: false, reply: 'reset' }])
                fx.on('GET /fapi/v3/positionRisk', [{ exec: true }, { before: ({ ex }) => ex.addPos('LONG', -0.007) }])
            },
            noSnapshot: (fx) => {
                fx.on('GET /fapi/v3/positionRisk', Array.from({ length: 3 }, () => ({ reply: 'reset' })))
                fx.on(K_ORDER, [{ exec: false, reply: 'reset' }])
            },
            partial: (fx) => {
                fx.on(K_ORDER, [{ exec: false, reply: ({ p }) => ({ status: 200, body: { status: 'PARTIALLY_FILLED', orderId: 1, clientOrderId: p.get('newClientOrderId'), executedQty: '0.002', origQty: p.get('quantity'), side: p.get('side'), time: Date.now() } }) }])
            },
        }

        before(async () => {
            let names = Object.keys(cases)
            let rs = await Promise.all(names.map(async (k) => {
                let fx = mkFake()
                nm++
                cases[k](fx)
                let err = await catchErr(run(fx))
                return { fx, err, nm }
            }))
            names.forEach((k, i) => {
                results[k] = rs[i]
            })
        })

        it('T25b 未送達、窗後查無、部位不變: NOT_EXECUTED, confirmedBy, POST恰1次', () => {
            let c = results.notExecuted
            assert.strictEqual(c.err.outcome, 'NOT_EXECUTED')
            assert.strictEqual(c.err.state.confirmedBy, 'notFoundAfterWindow+positionUnchanged')
            assert.strictEqual(c.fx.count(K_ORDER), 1)
        })

        it('§5.9 伺服器回未知、窗後查無: UNKNOWN(不重送, 帶tSign、conclusiveAfter、ID)', () => {
            let c = results.server
            assert.strictEqual(c.err.outcome, 'UNKNOWN')
            assert.strictEqual(c.err.execState, 'unknown')
            assert.strictEqual(c.err.state.conclusiveAfter, c.err.state.tSign + 8000)
            assert.strictEqual(c.err.state.clientOrderId, c.fx.reqsOf(K_ORDER)[0].p.newClientOrderId)
            assert.strictEqual(c.fx.count(K_ORDER), 1)
        })

        it('§5.9 窗後查無但部位已變: UNKNOWN', () => {
            let c = results.positionChanged
            assert.strictEqual(c.err.outcome, 'UNKNOWN')
            assert.strictEqual(c.err.state.reason, 'positionChanged')
        })

        it('§5.9 無部位快照、未知、窗後查無: 判不了未執行, UNKNOWN', () => {
            let c = results.noSnapshot
            assert.strictEqual(c.err.outcome, 'UNKNOWN')
            assert.strictEqual(c.err.state.reason, 'positionUnread')
        })

        it('§5.9 已知部分成交: PARTIAL_UNKNOWN, execState executed, 帶已知量', () => {
            let c = results.partial
            assert.deepStrictEqual([c.err.outcome, c.err.execState, c.err.state.maxExecutedQty], ['PARTIAL_UNKNOWN', 'executed', '0.002'])
        })

    })

})
