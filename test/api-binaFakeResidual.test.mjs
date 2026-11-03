import assert from 'assert'
import ott from '../src/ott.mjs'
import webina from '../src/WExchangeBinance.mjs'
import { blocked, catchErr, mkFake, mkTraceRec, startFake, stopFake } from './tools/binaFakeServer.mjs'


//殘單判定(bx297 §5.7; T32～T37、T44、T45、T65、T66)
describe('opBinaContractCancelResidualOrders (本機假伺服器)', function() {

    before(async () => {
        await startFake()
    })
    after(async () => {
        await stopFake()
        assert.deepStrictEqual(blocked, [], '不得有連外嘗試')
    })

    let opt = { forceTest: true }
    let K_DEL_ALGO = 'DELETE /fapi/v1/algoOrder'
    let K_POS = 'GET /fapi/v3/positionRisk'
    let OLD = () => Date.now() - 60000

    //以對外st: forTestAll為false而forceTest:true時須全走測試金鑰(T32)
    let mkFx = (amt) => {
        let fx = mkFake()
        if (amt !== undefined) {
            fx.ex.positions.LONG = amt
        }
        return fx
    }
    let addLeg = (fx, tdid, kind, o = {}) => {
        return fx.ex.addAlgo({
            clientAlgoId: `${tdid}_${kind}`,
            orderType: kind === 'SL' ? 'STOP_MARKET' : 'TAKE_PROFIT_MARKET',
            quantity: '0.007',
            createTime: OLD(),
            ...o,
        })
    }
    let reasons = (r) => r.skipped.map((x) => x.reason)
    let cids = (arr) => arr.map((x) => x.o.clientOrderId)

    it('T32 forceTest全部下傳: 全部請求皆TEST金鑰(修前用正式金鑰位置)', async () => {
        let fx = mkFx(0)
        fx.st.forTestAll = false
        fx.st.binance.forTest = false
        addLeg(fx, 'a', 'SL')
        await webina.opBinaContractCancelResidualOrders(fx.st, { forceTest: true })
        assert.ok(fx.reqs.length >= 4)
        for (let r of fx.reqs) {
            assert.strictEqual(r.keyKind, 'TEST', r.key)
        }
    })

    it('T33 撤單失敗: failed帶execState與code, 其他筆照做, 不拋(修前少一筆無訊息)', async () => {
        let fx = mkFx(0)
        addLeg(fx, 'a', 'SL')
        addLeg(fx, 'b', 'SL')
        fx.on(K_DEL_ALGO, (p) => p.get('algoId') === String(fx.ex.latestAlgo('a_SL').algoId), [{ reply: { status: 401, body: { code: -2015, msg: 'x' } } }])
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.strictEqual(r.failed.length, 1)
        assert.deepStrictEqual([r.failed[0].execState, r.failed[0].code], ['notExecuted', -2015])
        assert.deepStrictEqual(cids(r.cancelled), ['b_SL'])
    })

    it('T34 進行中之止損(部位>0、對腳-2013): skipped:partnerUnconfirmed, DELETE 0次(修前被撤)', async () => {
        let fx = mkFx(0.007)
        addLeg(fx, 'a', 'SL')
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual(reasons(r), ['partnerUnconfirmed'])
        assert.strictEqual(fx.count(K_DEL_ALGO), 0)
    })

    it('T35 對腳FINISHED且actualQty足量: 撤; 不足量: skipped; 其他狀態: skipped並列原因; 查詢失敗: skipped', async () => {
        let fx = mkFx(0.007)
        addLeg(fx, 'a', 'SL')
        addLeg(fx, 'a', 'TP', { algoStatus: 'FINISHED', actualQty: '0.007' })
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual(cids(r.cancelled), ['a_SL'])

        let fx2 = mkFx(0.007)
        addLeg(fx2, 'a', 'SL')
        addLeg(fx2, 'a', 'TP', { algoStatus: 'FINISHED', actualQty: '0.003' })
        let r2 = await webina.opBinaContractCancelResidualOrders(fx2.st, opt)
        assert.deepStrictEqual(reasons(r2), ['partnerUnconfirmed'])
        assert.strictEqual(fx2.count(K_DEL_ALGO), 0)

        let fx3 = mkFx(0.007)
        addLeg(fx3, 'a', 'SL')
        addLeg(fx3, 'a', 'TP', { algoStatus: 'CANCELED' })
        let r3 = await webina.opBinaContractCancelResidualOrders(fx3.st, opt)
        assert.deepStrictEqual(reasons(r3), ['partnerStatus:CANCELED'])
        assert.strictEqual(fx3.count(K_DEL_ALGO), 0)

        let fx4 = mkFx(0.007)
        addLeg(fx4, 'a', 'SL')
        fx4.on('GET /fapi/v1/algoOrder', Array.from({ length: 3 }, () => ({ reply: 'reset' })))
        let r4 = await webina.opBinaContractCancelResidualOrders(fx4.st, opt)
        assert.deepStrictEqual(reasons(r4), ['partnerUnconfirmed'])
    })

    it('T36 部位0, 單腳: 兩次讀皆0才撤; 請求序列單在前、部位在後', async () => {
        let fx = mkFx(0)
        addLeg(fx, 'a', 'SL')
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual(cids(r.cancelled), ['a_SL'])
        assert.strictEqual(fx.count(K_POS), 2)
        let keys = fx.reqs.map((x) => x.key)
        assert.ok(keys.indexOf('GET /fapi/v1/openAlgoOrders') < keys.indexOf(K_POS), '單在前')
        assert.ok(keys.lastIndexOf(K_POS) < keys.indexOf(K_DEL_ALGO), '兩次讀皆在撤單前')
        let rows = fx.reqsOf(K_POS)
        assert.ok(rows[1].t - rows[0].t >= 950, '重讀間隔')
    })

    it('T36 部位第一次0、第二次非0: 不撤(讀到舊0會撤真實止損)', async () => {
        let fx = mkFx(0)
        addLeg(fx, 'a', 'SL')
        fx.on(K_POS, [{ exec: true }, {
            before: ({ ex }) => {
                ex.positions.LONG = 0.007
            }
        }])
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual(reasons(r), ['positionChanging'])
        assert.strictEqual(fx.count(K_DEL_ALGO), 0)
    })

    it('T37 部位正常, n>2或兩筆同kind: 該組anomalous, 其他組照做(修前拋、其他不處理)', async () => {
        let fx = mkFx(1)
        addLeg(fx, 'a', 'SL')
        addLeg(fx, 'a', 'SL')
        addLeg(fx, 'a', 'TP')
        addLeg(fx, 'b', 'SL')
        addLeg(fx, 'b', 'SL')
        addLeg(fx, 'c', 'SL')
        addLeg(fx, 'c', 'TP', { algoStatus: 'FINISHED', actualQty: '0.007' })
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual(reasons(r).sort(), ['anomalous', 'anomalous', 'anomalous', 'anomalous', 'anomalous'].sort())
        assert.deepStrictEqual(cids(r.cancelled), ['c_SL'])
    })

    it('T44 部位0, 兩腳俱在: 兩腳皆撤(修前不撤, 孤單觸發會開反向部位)', async () => {
        let fx = mkFx(0)
        addLeg(fx, 'a', 'SL')
        addLeg(fx, 'a', 'TP')
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual(cids(r.cancelled).sort(), ['a_SL', 'a_TP'])
    })

    it('正常: 部位正常, 一SL一TP: 不動', async () => {
        let fx = mkFx(0.007)
        addLeg(fx, 'a', 'SL')
        addLeg(fx, 'a', 'TP')
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual([r.cancelled, r.skipped, r.failed, r.unprotected, r.underProtected], [[], [], [], [], []])
        assert.strictEqual(fx.count(K_DEL_ALGO), 0)
    })

    it('T45 查部位失敗: 不撤, 拋unknown', async () => {
        let fx = mkFx(0)
        addLeg(fx, 'a', 'SL')
        fx.on(K_POS, Array.from({ length: 3 }, () => ({ reply: 'reset' })))
        let err = await catchErr(webina.opBinaContractCancelResidualOrders(fx.st, opt))
        assert.strictEqual(err.execState, 'unknown')
        assert.strictEqual(err.outcome, 'POSITION_UNREAD')
        assert.strictEqual(fx.count(K_DEL_ALGO), 0)
    })

    it('T45 第二次讀部位失敗: 整批不撤, 拋unknown', async () => {
        let fx = mkFx(0)
        addLeg(fx, 'a', 'SL')
        fx.on(K_POS, [{ exec: true }, ...Array.from({ length: 3 }, () => ({ reply: 'reset' }))])
        await catchErr(webina.opBinaContractCancelResidualOrders(fx.st, opt))
        assert.strictEqual(fx.count(K_DEL_ALGO), 0)
    })

    it('T65 部位反向: reversedPosition(LONG負、SHORT正)', async () => {
        let fx = mkFx(-0.007)
        addLeg(fx, 'a', 'SL')
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual(reasons(r), ['reversedPosition'])
        assert.strictEqual(fx.count(K_DEL_ALGO), 0)

        let fx2 = mkFake()
        fx2.ex.positions.SHORT = 0.007
        addLeg(fx2, 'a', 'SL', { positionSide: 'SHORT', side: 'BUY' })
        let r2 = await webina.opBinaContractCancelResidualOrders(fx2.st, opt)
        assert.deepStrictEqual(reasons(r2), ['reversedPosition'])
    })

    it('T65 腿量超過部位(同kind合計, 含多tdid共用部位): oversized', async () => {
        let fx = mkFx(0.003)
        addLeg(fx, 'a', 'SL')
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual(reasons(r), ['oversized'])

        let fx2 = mkFx(0.01)
        addLeg(fx2, 'a', 'SL')
        addLeg(fx2, 'b', 'SL')
        let r2 = await webina.opBinaContractCancelResidualOrders(fx2.st, opt)
        assert.deepStrictEqual(reasons(r2), ['oversized', 'oversized'])
        assert.strictEqual(fx2.count(K_DEL_ALGO), 0)
    })

    it('T65 部位不為0、0筆腿: unprotected; 不動作(修前無單即提前返回)', async () => {
        let fx = mkFx(0.007)
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual(r.unprotected, [{ positionSide: 'LONG', amt: 0.007 }])
        assert.strictEqual(fx.count(K_POS), 1)
    })

    it('T65 腿齡<10秒: tooNew(進行中之進場; 部位0亦不撤)', async () => {
        let fx = mkFx(0)
        addLeg(fx, 'a', 'SL', { createTime: Date.now() })
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual(reasons(r), ['tooNew'])
        assert.strictEqual(fx.count(K_DEL_ALGO), 0)
    })

    it('§5.7 撤單後依剩餘腿回報: 對腳已成交而撤掉最後一腿, 部位仍在者列unprotected(另一筆交易之部位)', async () => {
        let fx = mkFx(0.007)
        addLeg(fx, 'a', 'SL')
        addLeg(fx, 'a', 'TP', { algoStatus: 'FINISHED', actualQty: '0.007' })
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual(cids(r.cancelled), ['a_SL'])
        assert.deepStrictEqual(r.unprotected, [{ positionSide: 'LONG', amt: 0.007 }])
    })

    it('§5.7 保護不足: 腿量少於部位或缺一腳: underProtected(不動作)', async () => {
        let fx = mkFx(0.01)
        addLeg(fx, 'a', 'SL', { quantity: '0.001' })
        addLeg(fx, 'a', 'TP', { quantity: '0.001' })
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual(r.underProtected, [
            { positionSide: 'LONG', kind: 'SL', legQty: 0.001, amt: 0.01 },
            { positionSide: 'LONG', kind: 'TP', legQty: 0.001, amt: 0.01 },
        ])
        assert.strictEqual(fx.count(K_DEL_ALGO), 0)
    })

    it('§5.7 腿之方向或類型與字尾不符: anomalous, 不得算作正常保護', async () => {
        for (let extra of [{ side: 'BUY' }, { orderType: 'TAKE_PROFIT_MARKET' }, { quantity: '0' }]) {
            let fx = mkFx(0.007)
            addLeg(fx, 'a', 'SL', extra)
            addLeg(fx, 'a', 'TP')
            let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
            assert.deepStrictEqual(reasons(r), ['anomalous', 'anomalous'], JSON.stringify(extra))
            assert.strictEqual(fx.count(K_DEL_ALGO), 0)
        }
    })

    it('§5.7 SHORT 對稱: 正常兩腳不動; 對腳足量撤; 未確認不撤; 部位0全撤', async () => {
        let mkS = (amt) => {
            let fx = mkFake()
            fx.ex.positions.SHORT = amt
            return fx
        }
        let shortLeg = (fx, tdid, kind, o = {}) => addLeg(fx, tdid, kind, { side: 'BUY', positionSide: 'SHORT', ...o })
        let fx = mkS(-0.007)
        shortLeg(fx, 'a', 'SL')
        shortLeg(fx, 'a', 'TP')
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual([r.cancelled, r.skipped, r.underProtected], [[], [], []])

        let fx2 = mkS(-0.007)
        shortLeg(fx2, 'a', 'SL')
        shortLeg(fx2, 'a', 'TP', { algoStatus: 'FINISHED', actualQty: '0.007' })
        let r2 = await webina.opBinaContractCancelResidualOrders(fx2.st, opt)
        assert.deepStrictEqual(cids(r2.cancelled), ['a_SL'])

        let fx3 = mkS(-0.007)
        shortLeg(fx3, 'a', 'SL')
        let r3 = await webina.opBinaContractCancelResidualOrders(fx3.st, opt)
        assert.deepStrictEqual(reasons(r3), ['partnerUnconfirmed'])

        let fx4 = mkS(0)
        shortLeg(fx4, 'a', 'SL')
        shortLeg(fx4, 'a', 'TP')
        let r4 = await webina.opBinaContractCancelResidualOrders(fx4.st, opt)
        assert.strictEqual(r4.cancelled.length, 2)
    })

    it('§5.7 撤單結果NOT_FOUND不列cancelled(未確認已撤)', async () => {
        let fx = mkFx(0)
        let a = addLeg(fx, 'a', 'SL')
        fx.on(K_DEL_ALGO, [{ reply: { status: 400, body: { code: -2011, msg: 'x' } } }])
        fx.on('GET /fapi/v1/algoOrder', Array.from({ length: 12 }, () => ({ reply: { status: 400, body: { code: -2013, msg: 'x' } } })))
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual(r.cancelled, [])
        assert.strictEqual(r.closedOtherwise[0].state, 'NOT_FOUND')
        assert.strictEqual(typeof a.algoId, 'number')
    })

    it('T65 腿無時間欄位: 視同tooNew(收嚴)', async () => {
        let fx = mkFx(0)
        addLeg(fx, 'a', 'SL', { createTime: undefined })
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual(reasons(r), ['tooNew'])
    })

    it('P29 tdid含底線依字尾解析: a_b_SL歸a_b, 非SL/TP字尾不處理', async () => {
        let fx = mkFx(0)
        addLeg(fx, 'a_b', 'SL')
        fx.ex.addAlgo({ clientAlgoId: 'other_XX', createTime: OLD() })
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual(cids(r.cancelled), ['a_b_SL'])
        assert.strictEqual(fx.count(K_DEL_ALGO), 1)
    })

    it('§5.7 撤單結果為FINISHED: 列closedOtherwise不列cancelled', async () => {
        let fx = mkFx(0)
        let a = addLeg(fx, 'a', 'SL')
        fx.on(K_DEL_ALGO, [{ reply: { status: 400, body: { code: -2011, msg: 'x' } } }])
        fx.on('GET /fapi/v1/algoOrder', [{ reply: { status: 200, body: { ...a, algoStatus: 'FINISHED', actualQty: '0.007' } } }])
        let r = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
        assert.deepStrictEqual(r.cancelled, [])
        assert.strictEqual(r.closedOtherwise[0].state, 'FINISHED')
    })

    it('T66 Residual與Market交錯: 止損留存, Market成功(修前止損被撤而Market仍回成功)', async () => {
        let fx = mkFx()
        let resResidual = null
        fx.on('POST /fapi/v1/algoOrder', (p) => p.get('type') === 'TAKE_PROFIT_MARKET', [{
            before: async () => {
                resResidual = await webina.opBinaContractCancelResidualOrders(fx.st, opt)
            },
        }])
        let tdid = `tdid-res-${Date.now()}`
        let r = await webina.opBinaContractMarket(fx.st, ott, 'long', tdid, 22, 0.04, 0.02, opt)
        assert.strictEqual(typeof r.idSl, 'string')
        assert.strictEqual(fx.count(K_DEL_ALGO), 0, '不得撤任何單')
        assert.strictEqual(fx.ex.latestAlgo(`${tdid}_SL`).algoStatus, 'NEW', '止損仍開啟')
        assert.deepStrictEqual(reasons(resResidual), ['tooNew'])
    })

    it('T43 residualDecision事件; 五種回調案結果相同', async () => {
        let results = []
        let unhandled = []
        let onUnhandled = (e) => unhandled.push(e)
        process.on('unhandledRejection', onUnhandled)
        try {
            let rec = mkTraceRec()
            for (let m of [{}, { onTrace: rec.onTrace }, {
                onTrace: () => {
                    throw new Error('cb')
                }
            }, { onTrace: () => Promise.reject(new Error('cb')) }, { onTrace: 1 }]) {
                let fx = mkFx(0.1)
                addLeg(fx, 'a', 'SL')
                addLeg(fx, 'a', 'TP')
                addLeg(fx, 'b', 'SL')
                let r = await webina.opBinaContractCancelResidualOrders(fx.st, { ...opt, ...m })
                results.push(reasons(r))
            }
            await new Promise((resolve) => setImmediate(resolve))
            for (let x of results) {
                assert.deepStrictEqual(x, results[0])
            }
            assert.deepStrictEqual(unhandled, [])
            let ds = rec.ofType('residualDecision')
            assert.deepStrictEqual(ds.map((e) => [e.tdid, e.decision]).sort(), [['a', 'keep'], ['b', 'skip']])
        }
        finally {
            process.off('unhandledRejection', onUnhandled)
        }
    })

})
