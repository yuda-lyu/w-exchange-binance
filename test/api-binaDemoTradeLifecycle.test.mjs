import assert from 'assert'
import _ from 'lodash-es'
import w from 'wsemi'
import ott, { nowTpeStrp } from '../src/ott.mjs'
import webina from '../src/WExchangeBinance.mjs'
import { bLive, cleanupByTdid, getAccountState, loadSt, opt } from './tools/binaDemoSetup.mjs'


//連外測試(明確啟用: BINA_LIVE_TEST=1): 下單生命週期(多空皆跑), market進場+TP+SL → 查詢 → 依tdid與實際部位清理
//⚠ 需要帳號有空餘algo額度. 因價格隨當前市況, 只驗必要欄位存在+型別+多空止盈損方向合理, 不比對絕對值
let suite = bLive ? describe : describe.skip
suite('幣安合約-下單生命週期 (測試端點, 明確啟用, 自動清理)', function() {
    this.timeout(120000)

    let st = null
    let uTrade = 22

    before(async () => {
        st = loadSt()
        uTrade = _.get(st, 'uTrade', 22)
        let s = await getAccountState(st)
        assert.deepStrictEqual(s, { nOrders: 0, positions: [] }, '測試前帳戶須已清回')
    })

    after(async () => {
        let s = await getAccountState(st)
        assert.deepStrictEqual(s, { nOrders: 0, positions: [] }, '測試後帳戶須已清回')
    })

    for (let mode of ['long', 'short']) {

        describe(`${mode}`, () => {

            let tdid = null
            let placed = null

            after(async () => {
                await cleanupByTdid(st, tdid, mode)
            })

            it('market進場+TP+SL: 回傳含entry/TP/SL必要欄位且方向合理', async () => {
                tdid = `tdid-${nowTpeStrp()}-${w.genID(6)}`
                placed = await webina.opBinaContractMarket(st, ott, mode, tdid, uTrade, 0.08, 0.05, opt)
                let r = placed

                //tdid對應
                assert.strictEqual(r.idTrade, tdid, 'idTrade須等於傳入tdid')

                //entry(普通單), RESULT回應須FILLED
                assert.ok(w.isestr(r.idEntry) && w.cdbl(r.idEntry) > 0, 'idEntry可轉正數')
                assert.strictEqual(_.get(r, 'resEntry.status', ''), 'FILLED', 'entry須已成交')
                assert.strictEqual(_.get(r, 'resEntry.clientOrderId', ''), `${tdid}_ENTRY`)

                //TP/SL(algo單)
                assert.ok(w.isestr(r.idTp) && w.cdbl(r.idTp) > 0, 'idTp(algoId)可轉正數')
                assert.ok(w.isestr(r.idSl) && w.cdbl(r.idSl) > 0, 'idSl(algoId)可轉正數')
                assert.strictEqual(r.isAlgoTp, true, 'TP為algo單')
                assert.strictEqual(r.isAlgoSl, true, 'SL為algo單')

                //方向合理
                if (mode === 'long') {
                    assert.ok(r.priceTakeProfit > r.priceStart, 'long止盈價應>進場價')
                    assert.ok(r.priceStopLoss < r.priceStart, 'long止損價應<進場價')
                }
                else {
                    assert.ok(r.priceTakeProfit < r.priceStart, 'short止盈價應<進場價')
                    assert.ok(r.priceStopLoss > r.priceStart, 'short止損價應>進場價')
                }

                //數量與金額合理
                assert.ok(w.cdbl(r.quantity) > 0, 'quantity應>0')
                assert.ok(r.uTrade >= uTrade, 'uTrade應>=設定下單金額')
            })

            it('queryOrderInfo: 可以ID與只給tdid查回entry/TP/SL', async () => {
                assert.ok(placed, '需有前一步下單結果')
                let q = await webina.opBinaContractQueryOrderInfo(st, { tdid, idEntry: placed.idEntry, idTp: placed.idTp, idSl: placed.idSl }, opt)
                assert.strictEqual(q.tdid, tdid, 'tdid一致')
                assert.strictEqual(q.resEntry.found, true, 'entry查得到')
                assert.ok(w.isestr(_.get(q, 'resEntry.status', '')), 'entry有status')
                assert.strictEqual(q.resTp.found, true, 'TP查得到')
                assert.strictEqual(q.resSl.found, true, 'SL查得到')
                let q2 = await webina.opBinaContractQueryOrderInfo(st, { tdid }, opt)
                assert.strictEqual(q2.resEntry.found, true)
                assert.strictEqual(q2.resTp.found, true)
                assert.strictEqual(q2.resSl.found, true)
            })

            it('同tdid第2次: TDID_USED, 部位不變', async () => {
                assert.ok(placed, '需有前一步下單結果')
                let err = null
                await webina.opBinaContractMarket(st, ott, mode, tdid, uTrade, 0.08, 0.05, opt).catch((e) => {
                    err = e
                })
                assert.ok(err)
                assert.strictEqual(err.outcome, 'TDID_USED')
            })

        })

    }

})
