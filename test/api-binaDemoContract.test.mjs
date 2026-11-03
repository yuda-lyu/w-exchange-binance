import assert from 'assert'
import _ from 'lodash-es'
import w from 'wsemi'
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures'
import { nowTpeStrp } from '../src/ott.mjs'
import webina from '../src/WExchangeBinance.mjs'
import { bLive, cleanupByTdid, getAccountState, getPosAmt, loadSt, opt } from './tools/binaDemoSetup.mjs'


//連外測試(明確啟用: BINA_LIVE_TEST=1): 測試端點之契約(bx297 §7.1), 假伺服器所依之幣安行為; 逐案清回
//SDK直呼只用於造出本套件正常不會產生之情形(同ID重送、極端觸發價), 一律測試金鑰與主機白名單
let suite = bLive ? describe : describe.skip
suite('幣安合約-測試端點契約 (明確啟用)', function() {
    this.timeout(120000)

    let st = null
    let SYMBOL = ''
    let client = null
    let price = 0
    let QTY = 0

    let mkId = (t) => `bf-${t}-${nowTpeStrp()}-${w.genID(4)}`

    let sdkErr = async (fn) => {
        try {
            let r = await fn()
            let data = await r.data()
            return { ok: true, data }
        }
        catch (err) {
            return { ok: false, code: err.code, name: err.name }
        }
    }

    before(async () => {
        st = loadSt()
        SYMBOL = st.symbol
        client = new DerivativesTradingUsdsFutures({ configurationRestAPI: { apiKey: st.binance.apiContractTest.key, apiSecret: st.binance.apiContractTest.secret, basePath: st.binance.basePathTest, timeout: 10000, retries: 0, backoff: 0 } })
        let r = await client.restAPI.markPrice({ symbol: SYMBOL })
        let m = await r.data()
        price = Number(m.markPrice)
        QTY = Number((22 / price + 0.001).toFixed(3))
        let s = await getAccountState(st)
        assert.deepStrictEqual(s, { nOrders: 0, positions: [] }, '測試前帳戶須已清回')
    })

    after(async () => {
        let s = await getAccountState(st)
        assert.deepStrictEqual(s, { nOrders: 0, positions: [] }, '測試後帳戶須已清回')
    })

    it('-2013: 查無單與查無algo', async () => {
        let id = mkId('nf')
        let a = await sdkErr(() => client.restAPI.queryOrder({ symbol: SYMBOL, origClientOrderId: id }))
        assert.deepStrictEqual([a.ok, a.code], [false, -2013])
        let b = await sdkErr(() => client.restAPI.queryAlgoOrder({ clientAlgoId: id }))
        assert.deepStrictEqual([b.ok, b.code], [false, -2013])
    })

    it('-2011與§5.6: 撤不存在之單不拋, NOT_FOUND', async () => {
        let r = await webina.opBinaContractCancelOrder(st, { clientOrderId: mkId('c') }, opt)
        assert.deepStrictEqual([r.state, r.alreadyClosed], ['NOT_FOUND', false])
        let r2 = await webina.opBinaContractCancelAlgoOrder(st, { clientAlgoId: mkId('a') }, opt)
        assert.deepStrictEqual([r2.state, r2.alreadyClosed], ['NOT_FOUND', false])
    })

    it('-1021: 時間戳舊之請求確定未執行(以recvWindow 1驗)', async () => {
        let a = await sdkErr(() => client.restAPI.currentAllOpenOrders({ symbol: SYMBOL, recvWindow: 1 }))
        assert.deepStrictEqual([a.ok, a.code], [false, -1021])
    })

    it('-4015: ID超過36字元', async () => {
        let a = await sdkErr(() => client.restAPI.newOrder({ symbol: SYMBOL, side: 'BUY', positionSide: 'LONG', type: 'LIMIT', timeInForce: 'GTC', quantity: QTY, price: (price * 0.8).toFixed(2), newClientOrderId: 'x'.repeat(37) }))
        assert.deepStrictEqual([a.ok, a.code], [false, -4015])
    })

    it('RESULT欄位: 市價單回FILLED與executedQty; 部位更新; 平倉清回', async () => {
        let cid = mkId('r')
        let r = await webina.opBinaContractMarketEntry(st, SYMBOL, 'BUY', 'LONG', QTY, { ...opt, clientOrderId: cid })
        assert.strictEqual(r.status, 'FILLED')
        assert.ok(Number(r.executedQty) > 0)
        assert.strictEqual(r.clientOrderId, cid)
        //同ID再送: 閘擋下
        let err = null
        await webina.opBinaContractMarketEntry(st, SYMBOL, 'BUY', 'LONG', QTY, { ...opt, clientOrderId: cid }).catch((e) => {
            err = e
        })
        assert.strictEqual(err.outcome, 'ID_USED')
        let amt = await getPosAmt(st, 'LONG')
        assert.ok(amt > 0)
        await webina.opBinaContractMarketEntry(st, SYMBOL, 'SELL', 'LONG', amt, opt)
        assert.strictEqual(await getPosAmt(st, 'LONG'), 0)
    })

    it('-4116與開啟中同clientAlgoId; algo查單最終可見; 撤單後同ID可重送(§5.5依據); placeProtect冪等', async () => {
        let tdid = mkId('p')
        let amt = 0
        try {
            await webina.opBinaContractMarketEntry(st, SYMBOL, 'BUY', 'LONG', QTY, opt)
            amt = await getPosAmt(st, 'LONG')
            let priceSl = Number((price * 0.9).toFixed(2))
            let priceTp = Number((price * 1.1).toFixed(2))
            let qty = amt.toFixed(3)
            let r = await webina.opBinaContractPlaceProtection(st, tdid, 'long', qty, priceSl, priceTp, opt)
            assert.deepStrictEqual([r.sl.status, r.tp.status], ['placed', 'placed'])
            //同ID同量同價: -4116比對相符, 冪等
            let r2 = await webina.opBinaContractPlaceProtection(st, tdid, 'long', qty, priceSl, priceTp, opt)
            assert.deepStrictEqual([r2.sl.status, r2.tp.status], ['placed', 'placed'])
            assert.strictEqual(r2.sl.algoId, r.sl.algoId, '同一張單')
            //同ID不同價: conflict
            let err = null
            await webina.opBinaContractPlaceProtection(st, tdid, 'long', qty, Number((price * 0.88).toFixed(2)), priceTp, opt).catch((e) => {
                err = e
            })
            assert.ok(err)
            assert.strictEqual(err.state.sl.reason, 'conflict')
            //直接以SDK驗-4116
            let dup = await sdkErr(() => client.restAPI.newAlgoOrder({ algoType: 'CONDITIONAL', symbol: SYMBOL, side: 'SELL', positionSide: 'LONG', type: 'STOP_MARKET', triggerPrice: priceSl, quantity: qty, workingType: 'MARK_PRICE', clientAlgoId: `${tdid}_SL` }))
            assert.deepStrictEqual([dup.ok, dup.code], [false, -4116])
            //algo查單最終可見: 輪詢至多3秒
            let found = false
            for (let i = 0; i < 15 && !found; i++) {
                let q = await webina.opBinaContractQueryOrderByClientId(st, { clientAlgoId: `${tdid}_SL` }, opt)
                found = q.found
            }
            assert.ok(found)
            //取消回終局
            let c = await webina.opBinaContractCancelAlgoOrder(st, r.sl.algoId, opt)
            assert.strictEqual(c.state, 'CANCELED')
            //撤單後再撤: -2011查清(撤後NEW有落後, 輪詢足以等到)
            let c2 = await webina.opBinaContractCancelAlgoOrder(st, r.sl.algoId, opt)
            assert.strictEqual(c2.state, 'CANCELED')
            assert.strictEqual(c2.alreadyClosed, true)
        }
        finally {
            await cleanupByTdid(st, tdid, 'long')
        }
    })

    it('殘單清理: 部位0時撤掉孤腿; 腿齡未滿不撤', async () => {
        let tdid = mkId('re')
        try {
            //無部位時可掛
            let priceSl = Number((price * 0.9).toFixed(2))
            let res = await sdkErr(() => client.restAPI.newAlgoOrder({ algoType: 'CONDITIONAL', symbol: SYMBOL, side: 'SELL', positionSide: 'LONG', type: 'STOP_MARKET', triggerPrice: priceSl, quantity: QTY, workingType: 'MARK_PRICE', clientAlgoId: `${tdid}_SL` }))
            assert.ok(res.ok)
            let r = await webina.opBinaContractCancelResidualOrders(st, opt)
            assert.ok(_.find(r.skipped, (x) => x.reason === 'tooNew' && x.o.tdid === tdid), '腿齡未滿10秒不撤')
            await new Promise((resolve) => setTimeout(resolve, 11000))
            let r2 = await webina.opBinaContractCancelResidualOrders(st, opt)
            assert.ok(_.find(r2.cancelled, (x) => x.o.tdid === tdid), '部位0時撤孤腿')
        }
        finally {
            await cleanupByTdid(st, tdid, 'long')
        }
    })

})
