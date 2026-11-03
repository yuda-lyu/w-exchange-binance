import assert from 'assert'
import webina from '../src/WExchangeBinance.mjs'
import { blocked, catchErr, mkFake, mkTraceRec, r2013, startFake, stopFake } from './tools/binaFakeServer.mjs'


//止損止盈同ID重送與已觸發排除(bx297 §5.5 placeProtect; T17、T56～T59), 經PlaceProtection驗; 多空皆跑
describe('placeProtect 與 opBinaContractPlaceProtection (本機假伺服器)', function() {

    before(async () => {
        await startFake()
    })
    after(async () => {
        await stopFake()
        assert.deepStrictEqual(blocked, [], '不得有連外嘗試')
    })

    let opt = { forceTest: true }
    let K_ALGO = 'POST /fapi/v1/algoOrder'
    let K_ORDER = 'POST /fapi/v1/order'
    let K_QA = 'GET /fapi/v1/algoOrder'
    let K_Q = 'GET /fapi/v1/order'
    let isSl = (p) => p.get('type') === 'STOP_MARKET'
    let isTp = (p) => p.get('type') === 'TAKE_PROFIT_MARKET'
    let isSlCid = (p) => String(p.get('clientAlgoId')).endsWith('_SL')
    let isSlOrd = (p) => String(p.get('origClientOrderId')).endsWith('_SL')
    let rej = (code) => ({ status: 400, body: { code, msg: 'x' } })
    let now = (body) => () => ({ status: 200, body: { createTime: Date.now(), ...body } })
    //首送前之補掛前置查詢(queryAlgoOrder得-2013再查queryOrder得-2013)要通過
    let pre = { reply: r2013 }

    for (let mode of ['long', 'short']) {

        let pos = mode === 'long' ? 'LONG' : 'SHORT'
        let dir = mode === 'long' ? 1 : -1
        let sideOut = mode === 'long' ? 'SELL' : 'BUY'
        let run = (fx, o = opt) => webina.opBinaContractPlaceProtection(fx.st, 'td-p', mode, '0.007', mode === 'long' ? 2900 : 3100, mode === 'long' ? 3100 : 2900, o)
        let mkFx = () => {
            let fx = mkFake()
            fx.ex.positions[pos] = 0.007 * dir
            return fx
        }
        let existing = (extra = {}) => ({ clientAlgoId: 'td-p_SL', orderType: 'STOP_MARKET', side: sideOut, positionSide: pos, quantity: '0.007', triggerPrice: mode === 'long' ? '2900' : '3100', ...extra })

        describe(mode, () => {

            it('正常: 兩腳掛上, 回傳兩腳狀態; 方向與positionSide正確', async () => {
                let fx = mkFx()
                let r = await run(fx)
                assert.strictEqual(r.sl.status, 'placed')
                assert.strictEqual(r.tp.status, 'placed')
                let q = fx.reqsOf(K_ALGO, isSl)[0].p
                assert.deepStrictEqual([q.clientAlgoId, q.quantity, q.side, q.positionSide], ['td-p_SL', '0.007', sideOut, pos])
            })

            it('入口查部位: 部位不足或反向即拒, 未送單; 查詢失敗亦未送單', async () => {
                for (let amt of [0, 0.006 * dir, -0.007 * dir]) {
                    let fx = mkFake()
                    fx.ex.positions[pos] = amt
                    let err = await catchErr(run(fx))
                    assert.strictEqual(err.outcome, 'POSITION_INSUFFICIENT', `amt ${amt}`)
                    assert.strictEqual(err.execState, 'notExecuted')
                    assert.strictEqual(fx.count(K_ALGO), 0)
                }
                let fx2 = mkFx()
                fx2.on('GET /fapi/v3/positionRisk', Array.from({ length: 3 }, () => ({ reply: 'reset' })))
                let err2 = await catchErr(run(fx2))
                assert.deepStrictEqual([err2.outcome, err2.execState], ['POSITION_UNREAD', 'notExecuted'])
                assert.strictEqual(fx2.count(K_ALGO), 0)
            })

            it('補掛前置: 同ID已FINISHED或已有觸發單: 不送(ID不佔位, 再送會多一張), triggered', async () => {
                let fx = mkFx()
                fx.ex.addAlgo(existing({ algoStatus: 'FINISHED', actualQty: '0.007' }))
                let err = await catchErr(run(fx))
                assert.deepStrictEqual([err.state.sl.status, err.state.sl.reason], ['triggered', 'alreadyTriggered'])
                assert.strictEqual(err.outcome, 'ENTERED_POSITION_CHANGED')
                assert.strictEqual(fx.count(K_ALGO), 0)

                let fx2 = mkFx()
                fx2.ex.addOrder({ clientOrderId: 'td-p_SL', side: sideOut, positionSide: pos })
                let err2 = await catchErr(run(fx2))
                assert.strictEqual(err2.state.sl.status, 'triggered')
                assert.strictEqual(fx2.count(K_ALGO), 0)
            })

            it('補掛前置: 查詢失敗: 不送, unknown; 同ID舊單已CANCELED: 可送', async () => {
                let fx = mkFx()
                fx.on(K_QA, isSlCid, [{ reply: 'reset' }])
                let err = await catchErr(run(fx))
                assert.deepStrictEqual([err.state.sl.status, err.state.sl.reason], ['unknown', 'precheckFailed'])
                assert.strictEqual(fx.count(K_ALGO, isSl), 0)

                let fx2 = mkFx()
                fx2.on(K_QA, isSlCid, [pre])
                fx2.on(K_Q, isSlOrd, [{ reply: 'reset' }])
                let err2 = await catchErr(run(fx2))
                assert.deepStrictEqual([err2.state.sl.status, err2.state.sl.reason], ['unknown', 'precheckFailed'])

                let fx3 = mkFx()
                fx3.ex.addAlgo(existing({ algoStatus: 'CANCELED' }))
                let r = await run(fx3)
                assert.strictEqual(r.sl.status, 'placed')
                assert.strictEqual(fx3.count(K_ALGO, isSl), 1)
            })

            it('T17 止損未送達: 同ID重送成功, 重送前已排除已觸發(查過open、queryAlgo、queryOrder、部位)', async () => {
                let fx = mkFx()
                fx.on(K_ALGO, isSl, [{ exec: false, reply: 'reset' }])
                let r = await run(fx)
                assert.strictEqual(r.sl.status, 'placed')
                let rows = fx.reqsOf(K_ALGO, isSl)
                assert.strictEqual(rows.length, 2)
                assert.strictEqual(rows[0].p.clientAlgoId, rows[1].p.clientAlgoId)
                //重送在各查詢之後: 兩次送單之間須依序查過open、queryAlgo、queryOrder、部位
                let iFirst = fx.reqs.indexOf(rows[0])
                let iSecond = fx.reqs.indexOf(rows[1])
                let between = fx.reqs.slice(iFirst + 1, iSecond).map((x) => x.key)
                for (let key of ['GET /fapi/v1/openAlgoOrders', K_QA, K_Q, 'GET /fapi/v3/positionRisk']) {
                    assert.ok(between.includes(key), `重送前須查 ${key}`)
                }
                assert.ok(rows[1].t - rows[0].t >= 600, '維持間隔')
            })

            it('T56 首送未知後重送-2021: open無→unknown, 不得notPlaced', async () => {
                let fx = mkFx()
                fx.on(K_ALGO, isSl, [{ exec: false, reply: 'reset' }, { reply: rej(-2021) }])
                let err = await catchErr(run(fx))
                assert.strictEqual(err.state.sl.status, 'unknown')
                assert.strictEqual(err.state.sl.reason, 'immediateTrigger')
                assert.strictEqual(err.outcome, 'ENTERED_PROTECTION_UNKNOWN')
            })

            it('T56 首送未知後重送-2021但open查得相符: placed', async () => {
                let fx = mkFx()
                fx.on(K_ALGO, isSl, [{ exec: false, reply: 'reset' }, { reply: rej(-2021), before: ({ ex }) => ex.addAlgo(existing({ createTime: Date.now() })) }])
                let r = await run(fx)
                assert.strictEqual(r.sl.status, 'placed')
            })

            it('T57 -4116而open比對不符: conflict(不得把舊單當已掛); 比對相符: placed', async () => {
                for (let [field, v] of [['quantity', '0.1'], ['triggerPrice', '1'], ['side', 'x'], ['positionSide', 'x'], ['orderType', 'TAKE_PROFIT_MARKET']]) {
                    let fx = mkFx()
                    fx.ex.addAlgo(existing({ [field]: v }))
                    let err = await catchErr(run(fx))
                    assert.strictEqual(err.state.sl.status, 'notPlaced', field)
                    assert.strictEqual(err.state.sl.reason, 'conflict', field)
                    assert.strictEqual(fx.count(K_ALGO, isSl), 1)
                }
                let fx2 = mkFx()
                fx2.ex.addAlgo(existing({ quantity: '0.0070', triggerPrice: mode === 'long' ? '2900.00' : '3100.00' }))
                let r = await run(fx2)
                assert.strictEqual(r.sl.status, 'placed')
            })

            it('T57 -4116而open查失敗: unknown, 不得placed, 不重送(排除不了原單存在或已觸發)', async () => {
                let fx = mkFx()
                fx.on(K_ALGO, isSl, [{ reply: rej(-4116) }, { reply: rej(-4116) }, { reply: rej(-4116) }])
                fx.on('GET /fapi/v1/openAlgoOrders', Array.from({ length: 2 }, () => ({ reply: 'reset' })))
                let err = await catchErr(run(fx))
                assert.deepStrictEqual([err.state.sl.status, err.state.sl.reason], ['unknown', 'openQueryFailed'])
                assert.strictEqual(fx.count(K_ALGO, isSl), 1)
            })

            it('T58 未知、open無、queryAlgoOrder -2013、queryOrder(clientAlgoId)查得: triggered, 不重送', async () => {
                let fx = mkFx()
                fx.on(K_ALGO, isSl, [{ exec: false, reply: 'reset', before: ({ ex }) => ex.addOrder({ clientOrderId: 'td-p_SL', side: sideOut, positionSide: pos }) }])
                let err = await catchErr(run(fx))
                assert.strictEqual(err.state.sl.status, 'triggered')
                assert.strictEqual(err.state.sl.reason, 'orderFound')
                assert.strictEqual(err.outcome, 'ENTERED_POSITION_CHANGED')
                assert.strictEqual(fx.count(K_ALGO, isSl), 1)
                assert.strictEqual(fx.count(K_ALGO, isTp), 0)
            })

            it('T59 未知、皆查無、部位不足或已反向: 不重送, unknown', async () => {
                for (let amt of [0.001 * dir, -0.007 * dir]) {
                    let fx = mkFx()
                    fx.on(K_ALGO, isSl, [{
                        exec: false,
                        reply: 'reset',
                        before: ({ ex }) => {
                            ex.positions[pos] = amt
                        },
                    }])
                    let err = await catchErr(run(fx))
                    assert.strictEqual(err.state.sl.status, 'unknown', `amt ${amt}`)
                    assert.strictEqual(err.state.sl.reason, 'positionInsufficient', `amt ${amt}`)
                    assert.strictEqual(fx.count(K_ALGO, isSl), 1)
                }
            })

            it('§5.5 排除已觸發之失敗皆不重送: queryOrder失敗、部位讀取失敗', async () => {
                let fx = mkFx()
                fx.on(K_ALGO, isSl, [{ exec: false, reply: 'reset' }])
                fx.on(K_Q, isSlOrd, [pre, { reply: 'reset' }])
                let err = await catchErr(run(fx))
                assert.strictEqual(err.state.sl.reason, 'orderQueryFailed')
                assert.strictEqual(fx.count(K_ALGO, isSl), 1)

                let fx2 = mkFx()
                fx2.on(K_ALGO, isSl, [{ exec: false, reply: 'reset' }])
                fx2.on('GET /fapi/v3/positionRisk', [{ exec: true }, ...Array.from({ length: 3 }, () => ({ reply: 'reset' }))])
                let err2 = await catchErr(run(fx2))
                assert.strictEqual(err2.state.sl.reason, 'positionUnread')
                assert.strictEqual(fx2.count(K_ALGO, isSl), 1)
            })

        })

    }

    let run = (fx, o = opt) => webina.opBinaContractPlaceProtection(fx.st, 'td-p', 'long', '0.007', 2900, 3100, o)
    let mkFx = () => {
        let fx = mkFake()
        fx.ex.positions.LONG = 0.007
        return fx
    }

    it('入口參數無效拋錯不回顯值, 請求0次', async () => {
        let fx = mkFx()
        let cases = [
            ['echo_me', 'long', 0.007, 2900, 3100],
            ['td', 'echo-me', 0.007, 2900, 3100],
            ['td', 'long', 0, 2900, 3100],
            ['td', 'long', 0.007, 'echo-me', 3100],
            ['td', 'long', 0.007, 2900, null],
        ]
        for (let a of cases) {
            let err = await catchErr(webina.opBinaContractPlaceProtection(fx.st, ...a, opt))
            assert.match(err.message, /^invalid /)
            assert.ok(!/echo.me/.test(err.message))
        }
        assert.strictEqual(fx.reqs.length, 0)
    })

    it('execState依兩腳實況: 皆確定未掛notExecuted; 有未知unknown; 有掛上executed', async () => {
        let fx = mkFx()
        fx.on(K_ALGO, isSl, [{ reply: rej(-2021) }])
        fx.on(K_ALGO, isTp, [{ reply: rej(-2021) }])
        let err = await catchErr(run(fx))
        assert.deepStrictEqual([err.outcome, err.execState], ['ENTERED_UNPROTECTED', 'notExecuted'])

        let fx2 = mkFx()
        fx2.on(K_ALGO, isSl, [{ reply: rej(-2021) }])
        fx2.on(K_ALGO, isTp, [{ reply: 'reset' }])
        fx2.on(K_QA, (p) => String(p.get('clientAlgoId')).endsWith('_TP'), [pre, { reply: now({ algoStatus: 'WEIRD' }) }])
        let err2 = await catchErr(run(fx2))
        assert.deepStrictEqual([err2.outcome, err2.execState], ['ENTERED_PROTECTION_UNKNOWN', 'unknown'])

        let fx3 = mkFx()
        fx3.on(K_ALGO, isTp, [{ reply: rej(-2021) }])
        let err3 = await catchErr(run(fx3))
        assert.deepStrictEqual([err3.outcome, err3.execState], ['ENTERED_SL_ONLY', 'executed'])
    })

    it('§5.5 queryAlgoOrder各狀態: TRIGGERING→triggered; CANCELED→notPlaced; NEW而open無→unknown; 其他值→unknown; 皆不重送', async () => {
        let table = [
            ['TRIGGERING', 'triggered'],
            ['TRIGGERED', 'triggered'],
            ['FINISHED', 'triggered'],
            ['CANCELED', 'notPlaced'],
            ['EXPIRED', 'notPlaced'],
            ['REJECTED', 'notPlaced'],
            ['NEW', 'unknown'],
            ['WEIRD', 'unknown'],
        ]
        for (let [algoStatus, status] of table) {
            let fx = mkFx()
            fx.on(K_ALGO, isSl, [{ exec: false, reply: 'reset' }])
            fx.on(K_QA, isSlCid, [pre, { reply: now({ algoStatus }) }])
            let err = await catchErr(run(fx))
            assert.strictEqual(err.state.sl.status, status, algoStatus)
            assert.strictEqual(fx.count(K_ALGO, isSl), 1, algoStatus)
        }
    })

    it('§5.5 查得同ID前次舊單(時間早於本次): 其終局不能證明本次情形, 視同未觀察到; 無時間欄: unknown不重送', async () => {
        //舊單CANCELED: 不得判notPlaced, 排除後同ID重送
        let fx = mkFx()
        fx.ex.addAlgo({ clientAlgoId: 'td-p_SL', algoStatus: 'CANCELED', orderType: 'STOP_MARKET', createTime: Date.now() - 60000 })
        fx.on(K_ALGO, isSl, [{ exec: false, reply: 'reset' }])
        let r = await run(fx)
        assert.strictEqual(r.sl.status, 'placed')
        assert.strictEqual(fx.count(K_ALGO, isSl), 2)

        //舊單FINISHED於本次送出後才查得(補掛前置未見, 模擬落後): 不得判triggered
        let fx2 = mkFx()
        let old = () => ({ status: 200, body: { algoStatus: 'FINISHED', createTime: Date.now() - 60000 } })
        fx2.on(K_ALGO, isSl, [{ exec: false, reply: 'reset' }])
        fx2.on(K_QA, isSlCid, [pre, ...Array.from({ length: 10 }, () => ({ reply: old }))])
        let r2 = await run(fx2)
        assert.strictEqual(r2.sl.status, 'placed')

        //無時間欄
        let fx3 = mkFx()
        fx3.on(K_ALGO, isSl, [{ exec: false, reply: 'reset' }])
        fx3.on(K_QA, isSlCid, [pre, { reply: { status: 200, body: { algoStatus: 'CANCELED' } } }])
        let err3 = await catchErr(run(fx3))
        assert.deepStrictEqual([err3.state.sl.status, err3.state.sl.reason], ['unknown', 'identityUnverified'])
        assert.strictEqual(fx3.count(K_ALGO, isSl), 1)
    })

    it('§5.5 queryAlgoOrder落後: 先-2013後FINISHED, 仍判triggered(輪詢至多2秒)', async () => {
        let fx = mkFx()
        fx.on(K_ALGO, isSl, [{ exec: false, reply: 'reset' }])
        fx.on(K_QA, isSlCid, [pre, { reply: r2013 }, { reply: r2013 }, { reply: now({ algoStatus: 'FINISHED' }) }])
        let err = await catchErr(run(fx))
        assert.strictEqual(err.state.sl.status, 'triggered')
    })

    it('§5.5 成功但本體不符(非JSON形狀、狀態非NEW、量價不符): 當unknown, 由open確認', async () => {
        let fx = mkFx()
        fx.on(K_ALGO, isSl, [{ exec: true, reply: { status: 200, body: { code: -1000 } } }])
        let r = await run(fx)
        assert.strictEqual(r.sl.status, 'placed')
        assert.strictEqual(fx.count(K_ALGO, isSl), 1)

        for (let bad of [{ algoStatus: 'REJECTED' }, { quantity: '9' }, { side: 'BUY' }]) {
            let fx2 = mkFx()
            fx2.on(K_ALGO, isSl, [{ exec: false, reply: ({ p }) => ({ status: 200, body: { algoId: 1, clientAlgoId: p.get('clientAlgoId'), algoStatus: 'NEW', orderType: p.get('type'), side: p.get('side'), positionSide: p.get('positionSide'), quantity: p.get('quantity'), triggerPrice: p.get('triggerPrice'), ...bad } }) }])
            let r2 = await run(fx2)
            assert.strictEqual(r2.sl.algoId !== '1', true, JSON.stringify(bad))
            assert.strictEqual(fx2.count(K_ALGO, isSl), 2, '查無後重送')
        }
    })

    it('§5.5 418: 不再送; 無代碼為未知, 有白名單代碼為notPlaced', async () => {
        let fx = mkFx()
        fx.on(K_ALGO, isSl, [{ reply: { status: 418, body: { code: -1003, msg: 'x' } } }])
        let err = await catchErr(run(fx))
        assert.deepStrictEqual([err.state.sl.status, err.state.sl.reason], ['notPlaced', 'rateLimitBan'])
        assert.strictEqual(fx.count(K_ALGO, isSl), 1)
        let fx2 = mkFx()
        fx2.on(K_ALGO, isSl, [{ reply: { status: 418, body: '' } }])
        let err2 = await catchErr(run(fx2))
        assert.strictEqual(err2.state.sl.status, 'unknown')
        assert.strictEqual(fx2.count(K_ALGO, isSl), 1)
    })

    it('§5.5 429連續3次: 等1000、2000ms, 次數上限3, notPlaced(確定未受理)', async () => {
        let fx = mkFx()
        let r429 = { reply: { status: 429, body: { code: -1015, msg: 'x' } } }
        fx.on(K_ALGO, isSl, [r429, r429, r429])
        let err = await catchErr(run(fx))
        assert.deepStrictEqual([err.state.sl.status, err.state.sl.reason], ['notPlaced', 'rateLimited'])
        let rows = fx.reqsOf(K_ALGO, isSl)
        assert.strictEqual(rows.length, 3)
        assert.ok(rows[1].t - rows[0].t >= 950)
        assert.ok(rows[2].t - rows[1].t >= 1950)
    })

    it('T43 觀察回調: protectSend、protectDone內容; 五種回調案結果相同', async () => {
        let results = []
        let unhandled = []
        let onUnhandled = (e) => unhandled.push(e)
        process.on('unhandledRejection', onUnhandled)
        try {
            let rec = mkTraceRec()
            let modes = [
                { name: '未傳', o: {} },
                { name: '紀錄器', o: { onTrace: rec.onTrace } },
                {
                    name: '拋錯',
                    o: {
                        onTrace: () => {
                            throw new Error('cb')
                        },
                    },
                },
                { name: '回傳rejection', o: { onTrace: () => Promise.reject(new Error('cb')) } },
                { name: '非函數', o: { onTrace: 'x' } },
            ]
            for (let m of modes) {
                let fx = mkFx()
                fx.on(K_ALGO, isSl, [{ exec: false, reply: 'reset' }])
                let r = await webina.opBinaContractPlaceProtection(fx.st, 'td-p', 'long', '0.007', 2900, 3100, { ...opt, ...m.o })
                results.push({ sl: r.sl.status, tp: r.tp.status, nSend: fx.count(K_ALGO) })
            }
            await new Promise((resolve) => setImmediate(resolve))
            for (let x of results) {
                assert.deepStrictEqual(x, results[0])
            }
            assert.deepStrictEqual(unhandled, [])
            let sends = rec.ofType('protectSend')
            assert.deepStrictEqual(sends.filter((e) => e.cid === 'td-p_SL').map((e) => e.n), [1, 2])
            let dones = rec.ofType('protectDone')
            assert.deepStrictEqual(dones.map((e) => e.status), ['placed', 'placed'])
            assert.ok(Object.isFrozen(dones[0]))
        }
        finally {
            process.off('unhandledRejection', onUnhandled)
        }
    })

    it('不自動平倉: 任何結果皆無市價單', async () => {
        let fx = mkFx()
        fx.on(K_ALGO, isSl, Array.from({ length: 5 }, () => ({ reply: 'reset' })))
        await catchErr(run(fx))
        assert.strictEqual(fx.count(K_ORDER), 0)
    })

})
