import assert from 'assert'
import ott from '../src/ott.mjs'
import webina from '../src/WExchangeBinance.mjs'
import { blocked, catchErr, mkFake, startFake, stopFake } from './tools/binaFakeServer.mjs'


//現貨第一階段(bx297 §5.10; T40、T41): 未實測, 只驗本套件之路由與錯誤語意
describe('現貨第一階段 (本機假伺服器)', function() {

    before(async () => {
        await startFake()
    })
    after(async () => {
        await stopFake()
        assert.deepStrictEqual(blocked, [], '不得有連外嘗試')
    })

    let opt = { forceTest: true }
    let K_BUY = 'POST /api/v3/order'
    let K_OCO = 'POST /api/v3/orderList/oco'
    let K_OTOCO = 'POST /api/v3/orderList/otoco'
    let runMarket = (fx, tdid = 'sp-1') => webina.opBinaSpotMarket(fx.st, ott, tdid, 10, 0.04, 0.02, opt)
    let runLimit = (fx, tdid = 'sp-2') => webina.opBinaSpotLimit(fx.st, ott, tdid, 3000, 10, 0.04, 0.02, opt)

    it('§5.10 市價: 帶newClientOrderId、listClientOrderId、recvWindow; 成功回傳欄位', async () => {
        let fx = mkFake()
        let r = await runMarket(fx)
        assert.strictEqual(fx.reqsOf(K_BUY)[0].p.newClientOrderId, 'sp-1_BUY')
        assert.strictEqual(fx.reqsOf(K_BUY)[0].p.recvWindow, '5000')
        assert.strictEqual(fx.reqsOf(K_OCO)[0].p.listClientOrderId, 'sp-1_OCO')
        assert.strictEqual(Number(r.quantity), 0.006)
        assert.ok(r.id !== '')
    })

    it('§5.10 限價: 帶listClientOrderId; 成功回傳欄位', async () => {
        let fx = mkFake()
        let r = await runLimit(fx)
        assert.strictEqual(fx.reqsOf(K_OTOCO)[0].p.listClientOrderId, 'sp-2_OTOCO')
        assert.ok(r.id !== '')
    })

    it('T40 OCO失敗: 整筆execState為executed(買入已成交), err.state含買入資訊, state.oco.execState區分(修前resBuy不掛)', async () => {
        let fx = mkFake()
        fx.on(K_OCO, [{ reply: 'reset' }])
        let err = await catchErr(runMarket(fx))
        assert.strictEqual(err.outcome, 'OCO_FAILED')
        assert.strictEqual(err.execState, 'executed')
        assert.strictEqual(err.state.oco.execState, 'unknown')
        assert.strictEqual(err.state.buy.status, 'FILLED')
        assert.strictEqual(err.state.buy.clientOrderId, 'sp-1_BUY')
        assert.strictEqual(err.state.buy.executedQty, '0.00600000')
        assert.strictEqual(err.state.oco.listClientOrderId, 'sp-1_OCO')
        assert.strictEqual(fx.count(K_OCO), 1, '不重送')

        let fx2 = mkFake()
        fx2.on(K_OCO, [{ reply: { status: 400, body: { code: -2010, msg: 'x' } } }])
        let err2 = await catchErr(runMarket(fx2))
        assert.deepStrictEqual([err2.execState, err2.state.oco.execState], ['executed', 'unknown'], '白名單外碼為未知')

        let fx3 = mkFake()
        fx3.on(K_OCO, [{ reply: { status: 400, body: { code: -1102, msg: 'x' } } }])
        let err3 = await catchErr(runMarket(fx3))
        assert.deepStrictEqual([err3.execState, err3.state.oco.execState], ['executed', 'notExecuted'])

        let fx4 = mkFake()
        fx4.on(K_OCO, [{ exec: false, reply: ({ p }) => ({ status: 200, body: { orderListId: 1, listClientOrderId: p.get('listClientOrderId'), orders: [] } }) }])
        let err4 = await catchErr(runMarket(fx4))
        assert.deepStrictEqual([err4.outcome, err4.state.oco.execState], ['OCO_FAILED', 'unknown'], 'OCO回應無兩腿不得當掛上')
    })

    let buyReply = (body) => ({ reply: ({ p }) => ({ status: 200, body: { orderId: 1, clientOrderId: p.get('newClientOrderId'), ...body } }) })

    it('T41 零成交: 拋BUY_ZERO_FILL, 不掛OCO(修前回成功且Invalid Date)', async () => {
        let fx = mkFake()
        fx.on(K_BUY, [buyReply({ status: 'EXPIRED', executedQty: '0.00000000', cummulativeQuoteQty: '0.00000000' })])
        let err = await catchErr(runMarket(fx))
        assert.strictEqual(err.outcome, 'BUY_ZERO_FILL')
        assert.strictEqual(err.execState, 'notExecuted')
        assert.strictEqual(fx.count(K_OCO), 0)

        let fx2 = mkFake()
        fx2.on(K_BUY, [buyReply({ status: 'NEW', executedQty: '0.00000000', cummulativeQuoteQty: '0.00000000' })])
        let err2 = await catchErr(runMarket(fx2))
        assert.strictEqual(err2.execState, 'unknown', '非終局之零成交為未知')
    })

    it('T41 有成交量而截位後為0或金額缺: 已執行, BUY_UNPROTECTABLE, 不得判未執行', async () => {
        for (let body of [
            { status: 'EXPIRED', executedQty: '0.00006', cummulativeQuoteQty: '5.5' },
            { status: 'FILLED', executedQty: '0.00006', cummulativeQuoteQty: '5.5' },
            { status: 'FILLED', executedQty: '0.006', cummulativeQuoteQty: '0' },
        ]) {
            let fx = mkFake()
            fx.on(K_BUY, [buyReply(body)])
            let err = await catchErr(runMarket(fx))
            assert.deepStrictEqual([err.outcome, err.execState], ['BUY_UNPROTECTABLE', 'executed'], JSON.stringify(body))
            assert.strictEqual(fx.count(K_OCO), 0)
        }
    })

    it('§5.10 OCO數量以十進位截位(0.29不得變0.28); 均價用原始成交量', async () => {
        let fx = mkFake({ digSpotQuantity: 2 })
        fx.on(K_BUY, [buyReply({ status: 'FILLED', executedQty: '0.29', cummulativeQuoteQty: '870' })])
        let r = await runMarket(fx)
        assert.strictEqual(fx.reqsOf(K_OCO)[0].p.quantity, '0.29')
        assert.strictEqual(r.priceStart, 3000)

        let fx2 = mkFake()
        fx2.on(K_BUY, [buyReply({ status: 'FILLED', executedQty: '0.00689', cummulativeQuoteQty: '20.67' })])
        let r2 = await runMarket(fx2)
        assert.strictEqual(fx2.reqsOf(K_OCO)[0].p.quantity, '0.0068')
        assert.strictEqual(Math.round(r2.priceStart), 3000, '均價不得因截位高估')
    })

    it('§5.10 買入回應clientOrderId不符或無orderId: 不得當成交, BUY_FAILED未知', async () => {
        let fx = mkFake()
        fx.on(K_BUY, [{ reply: { status: 200, body: { orderId: 1, clientOrderId: 'other', status: 'FILLED', executedQty: '0.006', cummulativeQuoteQty: '18' } } }])
        let err = await catchErr(runMarket(fx))
        assert.deepStrictEqual([err.outcome, err.execState], ['BUY_FAILED', 'unknown'])
    })

    it('§5.10 成功後時間函數失敗不讓結果遺失', async () => {
        let fx = mkFake()
        let r = await webina.opBinaSpotMarket(fx.st, () => {
            throw new Error('ott-fail')
        }, 'sp-3', 10, 0.04, 0.02, opt)
        assert.strictEqual(r.timeStart, '')
    })

    it('§5.10 買入未知: BUY_FAILED, 不掛OCO, 不重送, err.state帶ID', async () => {
        let fx = mkFake()
        fx.on(K_BUY, [{ reply: 'reset' }])
        let err = await catchErr(runMarket(fx))
        assert.strictEqual(err.outcome, 'BUY_FAILED')
        assert.strictEqual(err.execState, 'unknown')
        assert.strictEqual(err.state.buy.clientOrderId, 'sp-1_BUY')
        assert.strictEqual(fx.count(K_BUY), 1)
        assert.strictEqual(fx.count(K_OCO), 0)
    })

    it('§5.10 限價未知與被拒: OTOCO_FAILED, execState區分, 不重送', async () => {
        let fx = mkFake()
        fx.on(K_OTOCO, [{ reply: 'reset' }])
        let err = await catchErr(runLimit(fx))
        assert.deepStrictEqual([err.outcome, err.execState], ['OTOCO_FAILED', 'unknown'])
        assert.strictEqual(fx.count(K_OTOCO), 1)
        assert.strictEqual(err.state.listClientOrderId, 'sp-2_OTOCO')
        let fx2 = mkFake()
        fx2.on(K_OTOCO, [{ reply: { status: 400, body: { code: -2015, msg: 'x' } } }])
        let err2 = await catchErr(runLimit(fx2))
        assert.deepStrictEqual([err2.outcome, err2.execState], ['OTOCO_FAILED', 'notExecuted'])
    })

    it('§5.10 必傳tdid且合乎現貨ID格式; 參數無效入口拋錯, 請求0次', async () => {
        let fx = mkFake()
        for (let tdid of ['', null, 123, 'a_b', 'a.b', 'a'.repeat(31)]) {
            let err = await catchErr(runMarket(fx, tdid))
            assert.match(err.message, /invalid tdid/)
            let err2 = await catchErr(runLimit(fx, tdid))
            assert.match(err2.message, /invalid tdid/)
        }
        await catchErr(webina.opBinaSpotMarket(fx.st, ott, 'sp', 5, 0.04, 0.02, opt))
        await catchErr(webina.opBinaSpotLimit(fx.st, ott, 'sp', 'x', 10, 0.04, 0.02, opt))
        assert.strictEqual(fx.reqs.length, 0)
    })

    it('P24 不於函式庫內console.log', async () => {
        let fx = mkFake()
        fx.on(K_OCO, [{ reply: 'reset' }])
        let logs = []
        let orig = console.log
        console.log = (...a) => logs.push(a)
        try {
            await catchErr(runMarket(fx))
        }
        finally {
            console.log = orig
        }
        assert.deepStrictEqual(logs, [])
    })

})
