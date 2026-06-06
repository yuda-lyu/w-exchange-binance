import assert from 'assert'
import _ from 'lodash-es'
import w from 'wsemi'
import getSettings from '../src/getSettings.mjs'
import { nowTpeStrp } from '../src/ott.mjs'
import webina from '../src/WExchangeBinance.mjs'
import { cleanupByResult } from './binaSetup.mjs'


//下單生命週期: market進場+TP+SL → 查詢 → after自動清理(撤TP/SL+平倉)
//測試一律顯式傳 { forceTest: true } 給 op, 強制走測試金鑰+demo端點, 不論 settings.json 為何
//⚠ 需要帳號有空餘algo額度(未平倉algo<99). 若帳號algo已達100上限, 放TP會報 "Reach max stop order limit"
//因價格隨當前市況, 只驗「必要欄位存在+型別+多空止盈損方向合理」, 不比對絕對值
describe('幣安合約-下單生命週期 (apiContractTest, 自動清理)', function() {
    this.timeout(120000)

    let st = getSettings()
    let uTrade = _.get(st, 'uTrade', 22)

    let placed = null //本次測試建立的單, 供after清理(只清這筆, 不動帳號其他單)

    after(async () => {
        await cleanupByResult(placed)
    })

    it('market進場+TP+SL(long): 回傳含entry/TP/SL必要欄位且方向合理', async () => {
        let tdid = `tdid-${nowTpeStrp()}-${w.genID(6)}`
        let r = await webina.opBinaContractMarket(st, 'long', tdid, uTrade, 0.08, 0.05, { forceTest: true })
        placed = r

        //tdid對應
        assert.strictEqual(r.idTrade, tdid, 'idTrade須等於傳入tdid')

        //entry(普通單)
        assert.ok(w.isestr(r.idEntry) && w.cdbl(r.idEntry) > 0, 'idEntry可轉正數')
        let entryStatus = _.get(r, 'resEntry.status', '')
        assert.ok(entryStatus === 'NEW' || entryStatus === 'FILLED', `entry status應NEW/FILLED, 實得${entryStatus}`)
        assert.ok(String(_.get(r, 'resEntry.clientOrderId', '')).endsWith('_ENTRY'), 'entry clientOrderId以_ENTRY結尾')

        //TP/SL(algo單)
        assert.ok(w.isestr(r.idTp) && w.cdbl(r.idTp) > 0, 'idTp(algoId)可轉正數')
        assert.ok(w.isestr(r.idSl) && w.cdbl(r.idSl) > 0, 'idSl(algoId)可轉正數')
        assert.strictEqual(r.isAlgoTp, true, 'TP為algo單')
        assert.strictEqual(r.isAlgoSl, true, 'SL為algo單')

        //方向合理(long: 止盈價>進場價>止損價)
        assert.ok(r.priceTakeProfit > r.priceStart, 'long止盈價應>進場價')
        assert.ok(r.priceStopLoss < r.priceStart, 'long止損價應<進場價')

        //數量與金額合理
        assert.ok(r.quantity > 0, 'quantity應>0')
        assert.ok(r.uTrade >= uTrade, 'uTrade應>=設定下單金額')
    })

    it('queryOrderInfo: 可查回剛下單的entry/TP/SL', async () => {
        assert.ok(placed, '需有前一步下單結果')
        //比照存檔order JSON結構(含tdid/idEntry/idTp/idSl)傳入
        let oQuery = {
            tdid: placed.idTrade,
            idEntry: placed.idEntry,
            idTp: placed.idTp,
            idSl: placed.idSl,
        }
        let q = await webina.opBinaContractQueryOrderInfo(st, oQuery, { forceTest: true })
        assert.strictEqual(q.tdid, placed.idTrade, 'tdid一致')
        assert.ok(_.isObject(q.resEntry) && !q.resEntry.error, 'entry查得到(無error)')
        assert.ok(w.isestr(_.get(q, 'resEntry.status', '')), 'entry有status')
        assert.ok(_.isObject(q.resTp) && !q.resTp.error, 'TP查得到(無error)')
        assert.ok(_.isObject(q.resSl) && !q.resSl.error, 'SL查得到(無error)')
    })

})
