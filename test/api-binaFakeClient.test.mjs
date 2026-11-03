import assert from 'assert'
import axios from 'axios'
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures'
import getBinaClient from '../src/getBinaClient.mjs'
import ott from '../src/ott.mjs'
import webina from '../src/WExchangeBinance.mjs'
import { BASE, blocked, catchErr, mkFake, startFake, stopFake } from './tools/binaFakeServer.mjs'
import { bLive } from './tools/binaNetGuard.mjs'


//統一client之fail-closed(bx297 §5.1, P26、P30)與端點路由(T42、T64). 一律本機假伺服器, 假金鑰
describe('getBinaClient fail-closed 與端點路由 (本機假伺服器)', function() {

    before(async () => {
        await startFake()
    })
    after(async () => {
        await stopFake()
        assert.deepStrictEqual(blocked, [], '不得有連外嘗試')
    })

    //全部合約操作: 入口皆須fail-closed
    let opsContract = (st, opt) => [
        ['Market', () => webina.opBinaContractMarket(st, ott, 'long', 'tdid-t64', 22, 0.04, 0.02, opt)],
        ['MarketEntry', () => webina.opBinaContractMarketEntry(st, 'ETHUSDT', 'BUY', 'LONG', 0.007, opt)],
        ['PlaceProtection', () => webina.opBinaContractPlaceProtection(st, 'tdid-t64', 'long', 0.007, 2900, 3100, opt)],
        ['QuerySymbol', () => webina.opBinaContractQuerySymbolInfor(st, 'ETHUSDT', opt)],
        ['QueryAccount', () => webina.opBinaContractQueryAccountInfor(st, opt)],
        ['QueryPosition', () => webina.opBinaContractQueryPositionInfor(st, opt)],
        ['QueryOrderInfo', () => webina.opBinaContractQueryOrderInfo(st, { tdid: 'x' }, opt)],
        ['QueryOrderByClientId', () => webina.opBinaContractQueryOrderByClientId(st, { clientOrderId: 'x' }, opt)],
        ['ListOrders', () => webina.opBinaContractListOrders(st, opt)],
        ['History', () => webina.opBinaContractListOrdersHistory(st, ott, '2026-11-01T00:00:00', '2026-11-02T00:00:00', opt)],
        ['Trades', () => webina.opBinaContractListTradesFilled(st, ott, '2026-11-01T00:00:00', '2026-11-02T00:00:00', opt)],
        ['Cancel', () => webina.opBinaContractCancelOrder(st, '111', opt)],
        ['CancelAlgo', () => webina.opBinaContractCancelAlgoOrder(st, '222', opt)],
        ['CancelAll', () => webina.opBinaContractCancelAllOrder(st, opt)],
        ['CancelAllAlgo', () => webina.opBinaContractCancelAllAlgoOrder(st, opt)],
        ['Residual', () => webina.opBinaContractCancelResidualOrders(st, opt)],
    ]
    let opsSpot = (st, opt) => [
        ['SpotMarket', () => webina.opBinaSpotMarket(st, ott, 'tdid-t64', 10, 0.04, 0.02, opt)],
        ['SpotLimit', () => webina.opBinaSpotLimit(st, ott, 'tdid-t64', 3000, 10, 0.04, 0.02, opt)],
    ]

    let expectRejectNoRequest = async (fx, name, fn, re) => {
        let err = await catchErr(fn())
        assert.match(String(err.message), re, name)
        assert.strictEqual(fx.reqs.length, 0, `${name}: 請求須為0次`)
    }

    it('T64 空basePath: 全部操作入口拋錯, 請求0次(修前回落正式端點)', async () => {
        let fx = mkFake()
        fx.st.binance.basePathTest = ''
        fx.st.binance.basePathSpotTest = ''
        for (let [name, fn] of [...opsContract(fx.st, { forceTest: true }), ...opsSpot(fx.st, { forceTest: true })]) {
            await expectRejectNoRequest(fx, name, fn, /invalid st\.binance\.basePath/)
        }
    })

    it('T64 空金鑰: 全部操作入口拋錯, 請求0次', async () => {
        let fx = mkFake()
        fx.st.binance.apiContractTest = { key: '', secret: 'x' }
        fx.st.binance.apiSpotTest = { key: 'x', secret: '' }
        for (let [name, fn] of [...opsContract(fx.st, { forceTest: true }), ...opsSpot(fx.st, { forceTest: true })]) {
            await expectRejectNoRequest(fx, name, fn, /invalid st\.binance\.api/)
        }
    })

    it('T64 forTest配正式端點: 入口拋錯, 請求0次', async () => {
        for (let url of ['https://fapi.binance.com', 'https://fapi.binance.com/', 'HTTPS://FAPI.BINANCE.COM', 'https://fapi.binance.com.', 'https://fapi1.binance.com']) {
            let fx = mkFake()
            fx.st.binance.basePathTest = url
            for (let [name, fn] of opsContract(fx.st, { forceTest: true })) {
                await expectRejectNoRequest(fx, name, fn, /must not be the production endpoint/)
            }
        }
        for (let url of ['https://api.binance.com', 'https://api1.binance.com', 'https://api.binance.com.']) {
            let fx = mkFake()
            fx.st.binance.basePathSpotTest = url
            for (let [name, fn] of opsSpot(fx.st, { forceTest: true })) {
                await expectRejectNoRequest(fx, name, fn, /must not be the production endpoint/)
            }
        }
    })

    it('T64 全域axios.defaults.baseURL非空: 入口拋錯, 請求0次', async () => {
        let fx = mkFake()
        axios.defaults.baseURL = BASE
        try {
            for (let [name, fn] of [...opsContract(fx.st, { forceTest: true }), ...opsSpot(fx.st, { forceTest: true })]) {
                await expectRejectNoRequest(fx, name, fn, /invalid axios\.defaults\.baseURL/)
            }
        }
        finally {
            delete axios.defaults.baseURL
        }
    })

    it('T64 symbol為空: 使用st.symbol之操作入口拋錯, 請求0次', async () => {
        let fx = mkFake()
        fx.st.symbol = ''
        let names = ['Market', 'PlaceProtection', 'QueryPosition', 'ListOrders', 'CancelAll', 'Residual']
        for (let [name, fn] of opsContract(fx.st, { forceTest: true }).filter(([n]) => names.includes(n))) {
            await expectRejectNoRequest(fx, name, fn, /invalid st\.symbol/)
        }
    })

    it('T64 錯誤訊息不回顯值(V20): 訊息不含金鑰與網址', async () => {
        let fx = mkFake()
        fx.st.binance.apiContractTest = { key: 'SECRET-LOOKING-KEY', secret: '' }
        let err = await catchErr(webina.opBinaContractListOrders(fx.st, { forceTest: true }))
        assert.ok(!err.message.includes('SECRET-LOOKING-KEY'))
        let fx2 = mkFake()
        fx2.st.binance.basePathTest = 'not-a-url-value'
        let err2 = await catchErr(webina.opBinaContractListOrders(fx2.st, { forceTest: true }))
        assert.match(err2.message, /invalid st\.binance\.basePathTest/)
        assert.ok(!err2.message.includes('not-a-url-value'))
    })

    it('§5.1 全域baseURL之檢查看的與SDK用的是同一份axios: 同一實例之baseURL確實蓋過SDK之basePath', async () => {
        let fx = mkFake()
        let client = new DerivativesTradingUsdsFutures({ configurationRestAPI: { apiKey: fx.st.binance.apiContractTest.key, apiSecret: 'x', basePath: 'http://127.0.0.1:9', retries: 0, timeout: 3000 } })
        axios.defaults.baseURL = BASE
        try {
            let r = await client.restAPI.currentAllOpenOrders({ symbol: 'ETHUSDT' })
            assert.deepStrictEqual(await r.data(), [])
        }
        finally {
            delete axios.defaults.baseURL
        }
        assert.strictEqual(fx.count('GET /fapi/v1/openOrders'), 1)
    })

    it('§5.1 client固定設定: timeout 3000、retries 0、每請求新連線不累積閒置連線', () => {
        let fx = mkFake()
        let { client, recvWindow } = getBinaClient(fx.st, { forceTest: true })
        let c = client.restAPI.configuration
        assert.strictEqual(c.retries, 0)
        assert.strictEqual(c.baseOptions.timeout, 3000)
        assert.strictEqual(c.baseOptions.httpsAgent.keepAlive, false)
        assert.strictEqual(recvWindow, 5000)
    })

    it('T42 合約: forTest決定端點與金鑰位置, 實際連到假伺服器之測試端點(不經axios.defaults.baseURL)', async () => {
        let fx = mkFake()
        await webina.opBinaContractListOrders(fx.st, { forceTest: true })
        assert.ok(fx.reqs.length > 0)
        for (let r of fx.reqs) {
            assert.strictEqual(r.keyKind, 'TEST')
        }
        //forTest=false時用正式欄位, 路徑帶prod-must-not-be-used前綴者404, 證明basePath確實生效
        let fx2 = mkFake()
        fx2.st.binance.basePath = BASE
        await webina.opBinaContractListOrders(fx2.st, { forceTest: false })
        for (let r of fx2.reqs) {
            assert.strictEqual(r.keyKind, 'PROD')
        }
    })

    it('T42 現貨: 預設測試端點與測試金鑰, forceTest:false才用正式金鑰', async () => {
        let fx = mkFake({ forTestAll: undefined })
        await webina.opBinaSpotMarket(fx.st, ott, 'tdid-t42', 10, 0.04, 0.02)
        assert.strictEqual(fx.count('POST /api/v3/order'), 1)
        for (let r of fx.reqs) {
            assert.strictEqual(r.keyKind, 'SPOTTEST')
        }
        let fx2 = mkFake()
        fx2.st.binance.basePathSpot = BASE
        await webina.opBinaSpotLimit(fx2.st, ott, 'tdid-t42b', 3000, 10, 0.04, 0.02, { forceTest: false })
        for (let r of fx2.reqs) {
            assert.strictEqual(r.keyKind, 'SPOTPROD')
        }
    })

    it('§5.1 簽章請求一律帶recvWindow=5000', async () => {
        let fx = mkFake()
        await webina.opBinaContractListOrders(fx.st, { forceTest: true })
        await webina.opBinaContractQueryAccountInfor(fx.st, { forceTest: true })
        await webina.opBinaContractQueryPositionInfor(fx.st, { forceTest: true })
        let n = 0
        for (let r of fx.reqs.filter((x) => x.signed)) {
            assert.strictEqual(r.p.recvWindow, '5000', r.key)
            n++
        }
        assert.ok(n >= 4)
    })

    it('測試守門: 未明確啟用連外時, 非本機主機於網路層即被拒(不連外)', async () => {
        if (bLive) {
            return
        }
        let n0 = blocked.length
        let https = await import('https')
        await new Promise((resolve, reject) => {
            try {
                let req = https.get('https://fapi.binance.com/fapi/v1/time', () => reject(new Error('must not connect')))
                req.on('error', resolve)
            }
            catch (err) {
                resolve(err)
            }
        })
        assert.strictEqual(blocked.length, n0 + 1)
        assert.strictEqual(blocked[n0], 'fapi.binance.com')
        blocked.length = n0
    })

    it('K3 opt非預期視為未給: opt=null與非布林forceTest走預設(forTestAll)', async () => {
        let fx = mkFake()
        await webina.opBinaContractQueryPositionInfor(fx.st, null)
        await webina.opBinaContractQueryPositionInfor(fx.st, { forceTest: 'true' })
        for (let r of fx.reqs) {
            assert.strictEqual(r.keyKind, 'TEST')
        }
    })

})
