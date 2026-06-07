import assert from 'assert'
import _ from 'lodash-es'
import w from 'wsemi'
import getSettings from '../src/getSettings.mjs'
import ott from '../src/ott.mjs'
import webina from '../src/WExchangeBinance.mjs'
import { SYMBOL } from './binaSetup.mjs'


let st = getSettings()


//讀取型查詢: 不改變帳戶狀態, 走 apiContractTest. 因價格隨時變動, 只驗「必要欄位存在 + 型別/格式 + 合理範圍」, 不比對絕對值
//測試一律顯式傳 { forceTest: true } 給 op, 強制走測試金鑰+demo端點, 不論 settings.json 為何
describe('幣安合約-讀取型查詢 (apiContractTest)', function() {
    this.timeout(60000)

    it('querySymbolInfor: 回傳symbol物件含必要欄位', async () => {
        let r = await webina.opBinaContractQuerySymbolInfor(st, SYMBOL, { forceTest: true })
        assert.strictEqual(r.symbol, SYMBOL, 'symbol須等於設定值')
        assert.ok(_.isArray(r.filters) && r.filters.length > 0, 'filters應為非空陣列')
        assert.ok(_.isNumber(r.pricePrecision), 'pricePrecision應為數字')
        assert.ok(_.isNumber(r.quantityPrecision), 'quantityPrecision應為數字')
        assert.ok(w.isestr(r.status), 'status應為字串')
    })

    it('queryAccountInfor: 回傳帳戶資訊含餘額欄位', async () => {
        let r = await webina.opBinaContractQueryAccountInfor(st, { forceTest: true })
        assert.ok(w.isnum(r.totalWalletBalance), 'totalWalletBalance可轉數字')
        assert.ok(w.isnum(r.availableBalance), 'availableBalance可轉數字')
        assert.ok(_.isArray(r.assets), 'assets應為陣列')
        assert.ok(_.isArray(r.positions), 'positions應為陣列')
    })

    it('listOrders: 回傳當前未成交單陣列(每筆含必要欄位)', async () => {
        let r = await webina.opBinaContractListOrders(st, { forceTest: true })
        assert.ok(_.isArray(r), '應為陣列')
        for (let o of r) {
            assert.ok(w.isestr(w.cstr(o.orderId)), 'orderId可字串化')
            assert.ok(w.isestr(o.clientOrderId), 'clientOrderId為字串')
            assert.ok(w.isestr(o.status), 'status為字串')
            assert.ok(w.isbol(o.isAlgo), 'isAlgo為布林旗標')
        }
    })

    it('listOrdersHistory: 區間查詢回傳訂單歷史(含tdid/kind/status, 正規化結構)', async () => {
        let tEnd = ott().format('YYYY-MM-DDTHH:mm:ss')
        let tStart = ott().subtract(3, 'day').format('YYYY-MM-DDTHH:mm:ss')
        let r = await webina.opBinaContractListOrdersHistory(st, ott, tStart, tEnd, { forceTest: true })
        assert.ok(_.isArray(r), '應為陣列')
        for (let o of r) {
            assert.ok(w.isestr(w.cstr(o.orderId)), 'orderId可字串化')
            assert.ok('tdid' in o, '含tdid欄位')
            assert.ok('kind' in o, '含kind欄位')
            assert.ok('status' in o, '含status欄位')
            assert.ok(w.isbol(o.isAlgo), 'isAlgo為布林')
        }
    })

    it('listTradesFilled: 區間查詢回傳成交明細(含手續費/realizedPnl)', async () => {
        let tEnd = ott().format('YYYY-MM-DDTHH:mm:ss')
        let tStart = ott().subtract(3, 'day').format('YYYY-MM-DDTHH:mm:ss')
        let r = await webina.opBinaContractListTradesFilled(st, ott, tStart, tEnd, { forceTest: true })
        assert.ok(_.isArray(r), '應為陣列')
        for (let t of r) {
            assert.ok(w.isestr(t.id), 'trade id為字串')
            assert.ok(w.isestr(w.cstr(t.orderId)), 'orderId可字串化')
            assert.ok(w.isnum(t.price), 'price為數字')
            assert.ok(w.isnum(t.qty), 'qty為數字')
            assert.ok(w.isnum(t.commission), 'commission為數字')
            assert.ok(_.isFinite(t.realizedPnl), 'realizedPnl為有限數')
        }
    })

})
