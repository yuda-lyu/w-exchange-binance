import assert from 'assert'
import webina from '../src/WExchangeBinance.mjs'
import { blocked, catchErr, mkFake, mkTraceRec, startFake, stopFake } from './tools/binaFakeServer.mjs'


//取消語意(bx297 §5.6; T06、T26～T31、T69)
describe('取消類 (本機假伺服器)', function() {

    before(async () => {
        await startFake()
    })
    after(async () => {
        await stopFake()
        assert.deepStrictEqual(blocked, [], '不得有連外嘗試')
    })

    let opt = { forceTest: true }
    let K_DEL = 'DELETE /fapi/v1/order'
    let K_DEL_ALGO = 'DELETE /fapi/v1/algoOrder'
    let K_DEL_ALL = 'DELETE /fapi/v1/allOpenOrders'
    let K_DEL_ALL_ALGO = 'DELETE /fapi/v1/algoOpenOrders'

    let addOpen = (fx, o = {}) => fx.ex.addOrder({ status: 'NEW', executedQty: '0', clientOrderId: 'c1', ...o })
    let addAlgo = (fx, o = {}) => fx.ex.addAlgo({ clientAlgoId: 'a1', ...o })

    it('正常取消: state CANCELED, alreadyClosed false, positionChanged false, 請求帶recvWindow', async () => {
        let fx = mkFake()
        let o = addOpen(fx)
        let r = await webina.opBinaContractCancelOrder(fx.st, String(o.orderId), opt)
        assert.strictEqual(r.state, 'CANCELED')
        assert.strictEqual(r.alreadyClosed, false)
        assert.strictEqual(r.positionChanged, false)
        assert.strictEqual(fx.reqsOf(K_DEL)[0].p.recvWindow, '5000')
        let fx2 = mkFake()
        let a = addAlgo(fx2)
        let r2 = await webina.opBinaContractCancelAlgoOrder(fx2.st, a.algoId, opt)
        assert.strictEqual(r2.state, 'CANCELED')
        assert.strictEqual(r2.res.code, '200')
    })

    it('T06 DELETE真實逾時: SDK不重送, 本套件查後才重送(修前SDK自動重送3次)', async () => {
        let fx = mkFake()
        let o = addOpen(fx)
        fx.on(K_DEL, [{ exec: false, reply: 'hang' }])
        let r = await webina.opBinaContractCancelOrder(fx.st, String(o.orderId), opt)
        assert.strictEqual(r.state, 'CANCELED')
        assert.strictEqual(fx.count(K_DEL), 2)
        let keys = fx.reqs.map((x) => x.key)
        assert.ok(keys.indexOf('GET /fapi/v1/openOrders') > keys.indexOf(K_DEL), '先查')
        assert.ok(keys.lastIndexOf(K_DEL) > keys.indexOf('GET /fapi/v1/openOrders'), '後重送')
        let rows = fx.reqsOf(K_DEL)
        assert.notStrictEqual(rows[0].timestamp, rows[1].timestamp, '重送重新簽章')
    })

    it('T26 已撤、回應慢、open已無、查CANCELED: {CANCELED, alreadyClosed:true}, 不重送', async () => {
        let fx = mkFake()
        let o = addOpen(fx)
        fx.on(K_DEL, [{ exec: true, reply: 'reset' }])
        let r = await webina.opBinaContractCancelOrder(fx.st, String(o.orderId), opt)
        assert.deepStrictEqual([r.state, r.alreadyClosed], ['CANCELED', true])
        assert.strictEqual(fx.count(K_DEL), 1)
    })

    it('T26 已撤、回應慢、open落後仍見、重送-2011、查CANCELED: {CANCELED, alreadyClosed:true}(修前-2011或-1021)', async () => {
        let fx = mkFake()
        let o = addOpen(fx)
        fx.on(K_DEL, [{ exec: true, reply: 'reset' }])
        fx.on('GET /fapi/v1/openOrders', [{ reply: { status: 200, body: [{ orderId: o.orderId, clientOrderId: 'c1', status: 'NEW' }] } }])
        let r = await webina.opBinaContractCancelOrder(fx.st, String(o.orderId), opt)
        assert.deepStrictEqual([r.state, r.alreadyClosed], ['CANCELED', true])
        assert.strictEqual(fx.count(K_DEL), 2)
    })

    it('T27 逾時後重送得-1021: 維持unknown, 不判未執行(先未知後確定不可覆蓋)', async () => {
        let fx = mkFake()
        let o = addOpen(fx)
        fx.on(K_DEL, [{ exec: false, reply: 'reset' }, { exec: false, reply: { status: 400, body: { code: -1021, msg: 'x' } } }])
        let err = await catchErr(webina.opBinaContractCancelOrder(fx.st, String(o.orderId), opt))
        assert.strictEqual(err.execState, 'unknown')
        assert.strictEqual(err.binance.code, -1021)
        assert.strictEqual(fx.count(K_DEL), 2)
    })

    it('§5.6 單次送出得-1021: 確定未執行', async () => {
        let fx = mkFake()
        let o = addOpen(fx)
        fx.on(K_DEL, [{ exec: false, reply: { status: 400, body: { code: -1021, msg: 'x' } } }])
        let err = await catchErr(webina.opBinaContractCancelOrder(fx.st, String(o.orderId), opt))
        assert.strictEqual(err.execState, 'notExecuted')
    })

    it('T28 -2011、查得FILLED: {FILLED, positionChanged:true}(修前拋-2011)', async () => {
        let fx = mkFake()
        let o = fx.ex.addOrder({ status: 'FILLED', executedQty: '0.007', clientOrderId: 'c1' })
        let r = await webina.opBinaContractCancelOrder(fx.st, String(o.orderId), opt)
        assert.deepStrictEqual([r.state, r.alreadyClosed, r.positionChanged, r.executedQty], ['FILLED', true, true, '0.007'])
    })

    it('§5.6 -2011、查得CANCELED而有成交量: positionChanged true; 無成交量false', async () => {
        let fx = mkFake()
        let o = fx.ex.addOrder({ status: 'CANCELED', executedQty: '0.003', clientOrderId: 'c1' })
        let r = await webina.opBinaContractCancelOrder(fx.st, String(o.orderId), opt)
        assert.deepStrictEqual([r.state, r.positionChanged], ['CANCELED', true])
        let fx2 = mkFake()
        let o2 = fx2.ex.addOrder({ status: 'CANCELED', executedQty: '0', clientOrderId: 'c1' })
        let r2 = await webina.opBinaContractCancelOrder(fx2.st, String(o2.orderId), opt)
        assert.deepStrictEqual([r2.state, r2.positionChanged], ['CANCELED', false])
    })

    it('§5.6 -2011、查單一直NEW(落後未解): 拋unknown, 不可視為已撤', async () => {
        let fx = mkFake()
        let o = addOpen(fx)
        fx.on(K_DEL, [{ exec: false, reply: { status: 400, body: { code: -2011, msg: 'x' } } }])
        let err = await catchErr(webina.opBinaContractCancelOrder(fx.st, String(o.orderId), opt))
        assert.strictEqual(err.execState, 'unknown')
        assert.strictEqual(err.state.orderState, 'NEW')
    })

    it('§5.6 -2011、查單失敗: 拋unknown', async () => {
        let fx = mkFake()
        let o = fx.ex.addOrder({ status: 'FILLED' })
        fx.on('GET /fapi/v1/order', Array.from({ length: 30 }, () => ({ reply: 'reset' })))
        let err = await catchErr(webina.opBinaContractCancelOrder(fx.st, String(o.orderId), opt))
        assert.strictEqual(err.execState, 'unknown')
    })

    it('T29 CancelAlgo: -2011、查得FINISHED: positionChanged true, executedQty取actualQty', async () => {
        let fx = mkFake()
        let a = addAlgo(fx, { algoStatus: 'FINISHED', actualQty: '0.007' })
        let r = await webina.opBinaContractCancelAlgoOrder(fx.st, String(a.algoId), opt)
        assert.deepStrictEqual([r.state, r.alreadyClosed, r.positionChanged, r.executedQty], ['FINISHED', true, true, '0.007'])
    })

    it('T29 CancelAlgo: 撤後NEW落後: 續查得CANCELED', async () => {
        let fx = mkFake()
        let a = addAlgo(fx, { algoStatus: 'CANCELED' })
        let body = { ...a, algoStatus: 'NEW' }
        fx.on('GET /fapi/v1/algoOrder', [{ reply: { status: 200, body } }, { reply: { status: 200, body } }])
        let r = await webina.opBinaContractCancelAlgoOrder(fx.st, String(a.algoId), opt)
        assert.deepStrictEqual([r.state, r.alreadyClosed], ['CANCELED', true])
        assert.ok(fx.count('GET /fapi/v1/algoOrder') >= 3)
    })

    it('T29 CancelAlgo: 查得-2013: NOT_FOUND, 不設alreadyClosed', async () => {
        let fx = mkFake()
        let r = await webina.opBinaContractCancelAlgoOrder(fx.st, '12345', opt)
        assert.deepStrictEqual([r.state, r.alreadyClosed, r.positionChanged], ['NOT_FOUND', false, null], '未驗部位, 不得斷言未變')
    })

    it('§5.6 CancelAlgo: TRIGGERING未落定: alreadyClosed false, positionChanged true', async () => {
        let fx = mkFake()
        let a = addAlgo(fx, { algoStatus: 'TRIGGERING' })
        let r = await webina.opBinaContractCancelAlgoOrder(fx.st, String(a.algoId), opt)
        assert.deepStrictEqual([r.state, r.alreadyClosed, r.positionChanged], ['TRIGGERING', false, true])
    })

    it('T30 CancelAll: 逾時、清單已空: 成功帶inFlightUntil; DELETE恰1次(修前SDK重送)', async () => {
        for (let [key, run] of [[K_DEL_ALL, (st) => webina.opBinaContractCancelAllOrder(st, opt)], [K_DEL_ALL_ALGO, (st) => webina.opBinaContractCancelAllAlgoOrder(st, opt)]]) {
            let fx = mkFake()
            fx.on(key, [{ exec: true, reply: 'reset' }])
            let t0 = Date.now()
            let r = await run(fx.st)
            assert.strictEqual(r.state, 'CANCELED_ALL')
            assert.strictEqual(r.remaining, 0)
            assert.ok(r.inFlightUntil >= t0 + 6000, 'inFlightUntil為簽章時刻+視窗+時鐘餘裕')
            assert.strictEqual(fx.count(key), 1)
        }
    })

    it('T30 CancelAll: 逾時、清單不空: 拋unknown, state.remaining, DELETE恰1次(不自動重送, 可能是並行流程剛掛之止損)', async () => {
        let fx = mkFake()
        addAlgo(fx)
        fx.on(K_DEL_ALL_ALGO, [{ exec: false, reply: 'reset' }])
        let err = await catchErr(webina.opBinaContractCancelAllAlgoOrder(fx.st, opt))
        assert.strictEqual(err.execState, 'unknown')
        assert.strictEqual(err.state.remaining.length, 1)
        assert.strictEqual(fx.count(K_DEL_ALL_ALGO), 1)
    })

    it('§5.6 CancelAll: 正常inFlightUntil為null; 白名單拒絕確定未執行; 清單查失敗未知', async () => {
        let fx = mkFake()
        let r = await webina.opBinaContractCancelAllOrder(fx.st, opt)
        assert.deepStrictEqual([r.state, r.remaining, r.inFlightUntil], ['CANCELED_ALL', 0, null])
        let fx2 = mkFake()
        fx2.on(K_DEL_ALL, [{ reply: { status: 401, body: { code: -2015, msg: 'x' } } }])
        let err = await catchErr(webina.opBinaContractCancelAllOrder(fx2.st, opt))
        assert.strictEqual(err.execState, 'notExecuted')
        let fx3 = mkFake()
        fx3.on(K_DEL_ALL, [{ reply: 'reset' }])
        fx3.on('GET /fapi/v1/openOrders', [{ reply: 'reset' }])
        let err3 = await catchErr(webina.opBinaContractCancelAllOrder(fx3.st, opt))
        assert.strictEqual(err3.execState, 'unknown')
    })

    it('T31 CancelOrder字串大數ID: 原字串送出(修前進位成另一ID); algo同; 數字非安全整數與BigInt無效', async () => {
        let big = '9007199254740993'
        let fx = mkFake()
        await webina.opBinaContractCancelOrder(fx.st, big, opt)
        assert.strictEqual(fx.reqsOf(K_DEL)[0].p.orderId, big)
        let fx2 = mkFake()
        await webina.opBinaContractCancelAlgoOrder(fx2.st, big, opt)
        assert.strictEqual(fx2.reqsOf(K_DEL_ALGO)[0].p.algoId, big)
        let fx3 = mkFake()
        for (let v of [BigInt(1), 2 ** 60, -1, 0, 1.5, '1e3', 'abc', '', null, undefined, {}, { orderId: BigInt(1) }, { clientOrderId: '' }]) {
            await catchErr(webina.opBinaContractCancelOrder(fx3.st, v, opt))
        }
        assert.strictEqual(fx3.reqs.length, 0)
    })

    it('T69 以client ID取消未知後: 以交易所ID重送(client ID可重用, 用它重送可能撤到同ID新單)', async () => {
        let fx = mkFake()
        let o = addOpen(fx, { clientOrderId: 'c69' })
        fx.on(K_DEL, [{ exec: false, reply: 'reset' }])
        let r = await webina.opBinaContractCancelOrder(fx.st, { clientOrderId: 'c69' }, opt)
        assert.strictEqual(r.state, 'CANCELED')
        let rows = fx.reqsOf(K_DEL)
        assert.strictEqual(rows[0].p.origClientOrderId, 'c69')
        assert.strictEqual(rows[1].p.orderId, String(o.orderId))
        assert.strictEqual(rows[1].p.origClientOrderId, undefined)
        let fx2 = mkFake()
        let a = addAlgo(fx2, { clientAlgoId: 'a69' })
        fx2.on(K_DEL_ALGO, [{ exec: false, reply: 'reset' }])
        await webina.opBinaContractCancelAlgoOrder(fx2.st, { clientAlgoId: 'a69' }, opt)
        let rows2 = fx2.reqsOf(K_DEL_ALGO)
        assert.strictEqual(rows2[0].p.clientAlgoId, 'a69')
        assert.strictEqual(rows2[1].p.algoId, String(a.algoId))
    })

    it('T69 以client ID取消未知後: 原單已撤而同ID新單建立, 清單所見為新單時不得撤到新單, 拋unknown', async () => {
        let fx = mkFake()
        addOpen(fx, { clientOrderId: 'c70' })
        fx.on(K_DEL, [{
            exec: true,
            reply: 'reset',
            after: ({ ex }) => {
                ex.addOrder({ clientOrderId: 'c70', status: 'NEW', executedQty: '0', time: Date.now() + 1000 })
            },
        }])
        let err = await catchErr(webina.opBinaContractCancelOrder(fx.st, { clientOrderId: 'c70' }, opt))
        assert.strictEqual(err.execState, 'unknown')
        assert.strictEqual(err.state.orderState, 'OPEN_NOT_TARGET')
        assert.strictEqual(fx.count(K_DEL), 1, '不得再送')
        assert.strictEqual(fx.ex.latestOrder('c70').status, 'NEW', '新單未被撤')

        let fx2 = mkFake()
        addAlgo(fx2, { clientAlgoId: 'a70' })
        fx2.on(K_DEL_ALGO, [{
            exec: true,
            reply: 'reset',
            after: ({ ex }) => {
                ex.addAlgo({ clientAlgoId: 'a70', createTime: Date.now() + 1000 })
            },
        }])
        let err2 = await catchErr(webina.opBinaContractCancelAlgoOrder(fx2.st, { clientAlgoId: 'a70' }, opt))
        assert.strictEqual(err2.execState, 'unknown')
        assert.strictEqual(fx2.count(K_DEL_ALGO), 1)
    })

    it('§5.6 普通撤單回200而狀態非CANCELED或非目標單: 不得回CANCELED, 走查證', async () => {
        for (let bad of [(o) => ({ ...o, status: 'NEW' }), (o) => ({ ...o, status: 'FILLED' }), (o) => ({ ...o, orderId: 999 })]) {
            let fx = mkFake()
            let o = addOpen(fx)
            fx.on(K_DEL, [{ exec: false, reply: () => ({ status: 200, body: bad({ ...o }) }) }])
            let r = await webina.opBinaContractCancelOrder(fx.st, String(o.orderId), opt)
            assert.strictEqual(fx.count('GET /fapi/v1/openOrders'), 1)
            assert.strictEqual(fx.count(K_DEL), 2, '清單仍見, 以交易所ID重送')
            assert.strictEqual(r.state, 'CANCELED')
        }
    })

    it('§5.6 全撤遇限流: 不查不重送(同單筆)', async () => {
        let fx = mkFake()
        fx.on(K_DEL_ALL, [{ reply: { status: 429, body: '' } }])
        let err = await catchErr(webina.opBinaContractCancelAllOrder(fx.st, opt))
        assert.strictEqual(err.execState, 'unknown')
        assert.strictEqual(fx.count('GET /fapi/v1/openOrders'), 0)
        assert.strictEqual(fx.count(K_DEL_ALL), 1)
    })

    it('§5.6 重送上限3次: 全部無回應且清單仍見: 拋unknown, DELETE恰3次', async () => {
        let fx = mkFake()
        let o = addOpen(fx)
        fx.on(K_DEL, Array.from({ length: 5 }, () => ({ exec: false, reply: 'reset' })))
        let err = await catchErr(webina.opBinaContractCancelOrder(fx.st, String(o.orderId), opt))
        assert.strictEqual(err.execState, 'unknown')
        assert.strictEqual(fx.count(K_DEL), 3)
    })

    it('§5.6 成功但本體不符: 當未知走查證', async () => {
        let fx = mkFake()
        let o = addOpen(fx)
        fx.on(K_DEL, [{ exec: true, reply: { status: 200, body: { code: -1000 } } }])
        let r = await webina.opBinaContractCancelOrder(fx.st, String(o.orderId), opt)
        assert.deepStrictEqual([r.state, r.alreadyClosed], ['CANCELED', true])
    })

    it('§5.6 限流: 不查不重送, execState依分類', async () => {
        let fx = mkFake()
        let o = addOpen(fx)
        fx.on(K_DEL, [{ reply: { status: 429, body: '' } }])
        let err = await catchErr(webina.opBinaContractCancelOrder(fx.st, String(o.orderId), opt))
        assert.strictEqual(err.execState, 'unknown')
        assert.strictEqual(fx.count(K_DEL), 1)
        assert.strictEqual(fx.count('GET /fapi/v1/openOrders'), 0)
    })

    it('T43 觀察回調: cancelSend、cancelDone; 五種回調案結果相同', async () => {
        let results = []
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
                    }
                },
                { onTrace: () => Promise.reject(new Error('cb')) },
                { onTrace: 123 },
            ]
            for (let m of modes) {
                let fx = mkFake()
                let o = addOpen(fx)
                fx.on(K_DEL, [{ exec: false, reply: 'reset' }])
                let r = await webina.opBinaContractCancelOrder(fx.st, String(o.orderId), { ...opt, ...m })
                results.push({ state: r.state, n: fx.count(K_DEL) })
            }
            await new Promise((resolve) => setImmediate(resolve))
            for (let x of results) {
                assert.deepStrictEqual(x, results[0])
            }
            assert.deepStrictEqual(unhandled, [])
            assert.deepStrictEqual(rec.ofType('cancelSend').map((e) => e.n), [1, 2])
            assert.strictEqual(rec.ofType('cancelDone')[0].state, 'CANCELED')
        }
        finally {
            process.off('unhandledRejection', onUnhandled)
        }
    })

})
