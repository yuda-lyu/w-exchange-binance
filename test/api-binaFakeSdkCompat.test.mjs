import assert from 'assert'
import fs from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import ott from '../src/ott.mjs'
import webina from '../src/WExchangeBinance.mjs'
import getBinaClient, { getBinaSpotClient } from '../src/getBinaClient.mjs'
import classifyBinaErr from '../src/classifyBinaErr.mjs'
import { NetworkError } from '@binance/common'
import { blocked, catchErr, mkFake, startFake, stopFake } from './tools/binaFakeServer.mjs'


//SDK 跨主版號升級之相容性(R-SDK): 全部以本機假伺服器或讀檔驗證, 不連外
//來源: @binance/spot 33.x~34.x、@binance/derivatives-trading-usds-futures 38.x~39.x 之破壞性變更(見各 SDK 之 CHANGELOG)
describe('SDK 升版相容 (本機假伺服器與讀檔, 不連外)', function() {

    before(async () => {
        await startFake()
    })
    after(async () => {
        await stopFake()
        assert.deepStrictEqual(blocked, [], '不得有連外嘗試')
    })

    let opt = { forceTest: true }
    let dirSrc = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
    let SPOT_FILES = ['opBinaSpotMarket.mjs', 'opBinaSpotLimit.mjs']

    //src 內全部 client.restAPI.<方法>( 站點, 依檔案分現貨與合約
    let scanSites = (text) => {
        return [...text.matchAll(/restAPI\.(\w+)\(/g)].map((m) => m[1])
    }
    let getSiteNames = () => {
        let spot = new Set()
        let contract = new Set()
        for (let fn of fs.readdirSync(dirSrc).filter((f) => f.endsWith('.mjs'))) {
            let names = scanSites(fs.readFileSync(join(dirSrc, fn), 'utf8'))
            for (let n of names) {
                (SPOT_FILES.includes(fn) ? spot : contract).add(n)
            }
        }
        return { spot, contract }
    }

    //型別檔內標 @deprecated 之方法名(含 REST 與 WebSocket API; 只取緊接於註解區塊之後的方法宣告)
    let findDeprecated = (dts) => {
        let names = new Set()
        let inComment = false
        let dep = false
        let pend = false
        for (let ln of dts.split(/\r?\n/)) {
            let t = ln.trim()
            if (inComment) {
                if (t.includes('@deprecated')) {
                    dep = true
                }
                if (t.includes('*/')) {
                    inComment = false
                    pend = dep
                }
                continue
            }
            if (t.startsWith('/**')) {
                inComment = !t.includes('*/')
                dep = t.includes('@deprecated')
                pend = !inComment && dep
                continue
            }
            if (pend) {
                let m = /^(?:async\s+)?(\w+)\s*[(<]/.exec(t)
                if (m) {
                    names.add(m[1])
                }
                pend = false
            }
        }
        return names
    }

    let getDtsPath = (pkg) => {
        return join(dirname(fileURLToPath(import.meta.resolve(pkg))), 'index.d.ts')
    }

    it('R-SDK 掃描器自測: 站點掃描只取 restAPI.<名>(, 棄用掃描只取 @deprecated 後之方法宣告', () => {
        assert.deepStrictEqual(scanSites('client.restAPI.orderOco({})\nlet a = restAPI.newOrder(\n// restAPI.x 無括號'), ['orderOco', 'newOrder'])
        let dts = [
            '  /**',
            '   * note',
            '   * @deprecated',
            '   */',
            '  orderOco(requestParameters: R): Promise<X>;',
            '  /** one line */',
            '  orderListOco(r: R): Promise<X>;',
            '  /** @deprecated */',
            '  async oldOne(r: R): Promise<X>;',
            '  /**',
            '   * @deprecated',
            '   */',
            '  interface Foo {',
            '  /**',
            '   * ok',
            '   */',
            '  newOrder(r: R): Promise<X>;',
        ].join('\n')
        assert.deepStrictEqual([...findDeprecated(dts)].sort(), ['oldOne', 'orderOco'])
    })

    it('R-SDK 本套件用到之 SDK 方法於已安裝版本皆存在(升版後被移除者即時發現)', () => {
        let fx = mkFake()
        let { spot, contract } = getSiteNames()
        assert.ok(spot.size >= 3 && contract.size >= 20, `站點掃描範圍異常 spot=${spot.size} contract=${contract.size}`)
        let spotApi = getBinaSpotClient(fx.st, opt).client.restAPI
        let contractApi = getBinaClient(fx.st, opt).client.restAPI
        let missing = [
            ...[...spot].filter((n) => typeof spotApi[n] !== 'function').map((n) => `spot.${n}`),
            ...[...contract].filter((n) => typeof contractApi[n] !== 'function').map((n) => `contract.${n}`),
        ]
        assert.deepStrictEqual(missing, [])
    })

    it('R-SDK 本套件用到之 SDK 方法無一於已安裝版本標 @deprecated(orderOco、orderListPlace 等有替代者須改用替代者)', () => {
        let { spot, contract } = getSiteNames()
        let depSpot = findDeprecated(fs.readFileSync(getDtsPath('@binance/spot'), 'utf8'))
        let depContract = findDeprecated(fs.readFileSync(getDtsPath('@binance/derivatives-trading-usds-futures'), 'utf8'))
        assert.ok(depSpot.has('orderOco'), '棄用掃描失效: spot 之 orderOco 應被標為棄用')
        assert.deepStrictEqual([...spot].filter((n) => depSpot.has(n)), [], '現貨站點用到棄用方法')
        assert.deepStrictEqual([...contract].filter((n) => depContract.has(n)), [], '合約站點用到棄用方法')
    })

    it('R-SDK allOrders 之 symbol 於 derivatives 38.0.3 改選填(SDK 不再於缺 symbol 時拋錯): 每次請求皆帶 symbol, 空 symbol 於入口擋下且請求 0 次', async () => {
        let T0 = '2026-11-01T00:00:00'
        let T1 = '2026-11-02T00:00:00'
        let fx = mkFake()
        await webina.opBinaContractListOrdersHistory(fx.st, ott, T0, T1, opt)
        let reqs = fx.reqsOf('GET /fapi/v1/allOrders')
        assert.ok(reqs.length >= 1)
        reqs.forEach((r) => assert.strictEqual(r.p.symbol, 'ETHUSDT'))

        let fx2 = mkFake()
        fx2.st.symbol = ''
        let err = await catchErr(webina.opBinaContractListOrdersHistory(fx2.st, ott, T0, T1, opt))
        assert.match(err.message, /invalid st\.symbol/)
        assert.strictEqual(fx2.reqs.length, 0, '空 symbol 不得送出 allOrders(否則會回全商品)')
    })

    it('R-SDK common 2.5.2 之 NetworkError 多帶 transportCode: 分類不變(未知、source:network、讀取可重試)', () => {
        for (let code of [undefined, 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED']) {
            let e = new NetworkError('x', code)
            let r = classifyBinaErr(e)
            assert.deepStrictEqual([r.execState, r.source, r.retryRead], ['unknown', 'network', true], String(code))
        }
    })

    it('R-SDK 真實逾時/斷線得之 NetworkError(SDK 以 retries:0 送出)分類為未知、source:network, 帶 transportCode 字串或無', async () => {
        let fx = mkFake()
        fx.on('GET /fapi/v1/openOrders', [{ reply: 'reset' }, { reply: 'reset' }, { reply: 'reset' }])
        let err = await catchErr(webina.opBinaContractListOrders(fx.st, opt))
        assert.strictEqual(err.execState, 'unknown')
        assert.strictEqual(err.binance.source, 'network')
        assert.strictEqual(err.binance.sdkErrorName, 'NetworkError')
        let tc = err.cause.transportCode
        assert.ok(tc === undefined || /^[A-Z][A-Z0-9_]*$/.test(tc), `transportCode: ${tc}`)
    })

    //---- 新列舉值與空值: 本套件不因新值而拋錯或誤判 ----

    it('R-SDK CANCEL_ONLY(spot 34.0.5 新增之 symbolStatus 列舉)與未知狀態值出現於合約商品資訊: 原樣回傳, 不拋錯', async () => {
        for (let status of ['CANCEL_ONLY', 'BRAND_NEW_STATUS', null]) {
            let fx = mkFake()
            fx.on('GET /fapi/v1/exchangeInfo', [{ reply: { status: 200, body: { symbols: [{ symbol: 'ETHUSDT', status, symbolStatus: 'CANCEL_ONLY', pricePrecision: 2, quantityPrecision: 3, filters: [] }] } } }])
            let r = await webina.opBinaContractQuerySymbolInfor(fx.st, 'ETHUSDT', opt)
            assert.strictEqual(r.symbol, 'ETHUSDT')
            assert.strictEqual(r.status, status, `status ${status}`)
            assert.strictEqual(r.symbolStatus, 'CANCEL_ONLY')
        }
    })

    let K_BUY = 'POST /api/v3/order'
    let K_OCO = 'POST /api/v3/orderList/oco'
    let runMarket = (fx, tdid = 'sp-c1') => webina.opBinaSpotMarket(fx.st, ott, tdid, 10, 0.04, 0.02, opt)
    let buyReply = (body) => ({ reply: ({ p }) => ({ status: 200, body: { orderId: 1, clientOrderId: p.get('newClientOrderId'), ...body } }) })

    it('R-SDK 現貨買入回應之可為空欄位(fills 之 commission 與 commissionAsset 為 null、無 fills、symbolStatus 為 CANCEL_ONLY): 成功, 數量與 OCO 依成交量', async () => {
        let bodies = [
            { status: 'FILLED', executedQty: '0.006', cummulativeQuoteQty: '18', symbolStatus: 'CANCEL_ONLY', workingTime: null, selfTradePreventionMode: null, fills: [{ price: '3000', qty: '0.006', commission: null, commissionAsset: null, tradeId: 1 }] },
            { status: 'FILLED', executedQty: '0.006', cummulativeQuoteQty: '18', fills: null },
            { status: 'FILLED', executedQty: '0.006', cummulativeQuoteQty: '18', fills: [] },
        ]
        for (let body of bodies) {
            let fx = mkFake()
            fx.on(K_BUY, [buyReply(body)])
            let r = await runMarket(fx)
            assert.strictEqual(Number(r.quantity), 0.006, JSON.stringify(body))
            assert.strictEqual(fx.count(K_OCO), 1)
            assert.strictEqual(fx.reqsOf(K_OCO)[0].p.quantity, '0.0060', 'OCO 數量為成交量依 digSpotQuantity(4)十進位截位')
        }
    })

    it('R-SDK 現貨買入狀態為未見過之值(如 CANCEL_ONLY): 零成交不得判確定未執行(unknown)、不掛 OCO; 有成交量者依成交量掛 OCO', async () => {
        for (let status of ['CANCEL_ONLY', 'BRAND_NEW_STATUS']) {
            let fx = mkFake()
            fx.on(K_BUY, [buyReply({ status, executedQty: '0.00000000', cummulativeQuoteQty: '0.00000000' })])
            let err = await catchErr(runMarket(fx))
            assert.deepStrictEqual([err.outcome, err.execState], ['BUY_ZERO_FILL', 'unknown'], status)
            assert.strictEqual(fx.count(K_OCO), 0)

            let fx2 = mkFake()
            fx2.on(K_BUY, [buyReply({ status, executedQty: '0.006', cummulativeQuoteQty: '18' })])
            let r = await runMarket(fx2)
            assert.strictEqual(Number(r.quantity), 0.006, status)
            assert.strictEqual(fx2.count(K_OCO), 1)
        }
    })

    it('R-SDK OCO 回應含未見過之列舉值與空值(listStatusType、orderReports 內 null): 只依 orderListId、listClientOrderId、兩腿判定, 成功', async () => {
        let fx = mkFake()
        fx.on(K_OCO, [{ reply: ({ p }) => ({ status: 200, body: { orderListId: 9, contingencyType: 'OCO', listStatusType: 'CANCEL_ONLY', listOrderStatus: 'BRAND_NEW_STATUS', listClientOrderId: p.get('listClientOrderId'), transactionTime: Date.now(), symbol: 'ETHUSDT', orders: [{ orderId: 1 }, { orderId: 2 }], orderReports: [{ orderId: 1, status: 'CANCEL_ONLY', commissionAsset: null, N: null }, null] } }) }])
        let r = await runMarket(fx)
        assert.strictEqual(String(r.id), '9')
        assert.strictEqual(fx.count(K_OCO), 1)
    })

    it('R-SDK 成交明細之手續費幣別為 null(對應 spot executionReport.N 改 nullable): 不拋錯, 手續費為 0, 幣別為空字串而非 null', async () => {
        let fx = mkFake()
        let t = Date.parse('2026-11-01T01:00:00+08:00')
        let body = [
            { id: 1, orderId: 11, time: t, side: 'BUY', positionSide: 'LONG', price: '3000', qty: '0.006', quoteQty: '18', commission: null, commissionAsset: null, realizedPnl: '0', maker: false, buyer: true },
            { id: 2, orderId: 12, time: t + 1, side: 'SELL', positionSide: 'LONG', price: '3001', qty: '0.006', quoteQty: '18.006', commission: '0.0072', commissionAsset: 'USDT', realizedPnl: '0.006', maker: true, buyer: false },
        ]
        fx.on('GET /fapi/v1/userTrades', [{ reply: { status: 200, body } }])
        let rs = await webina.opBinaContractListTradesFilled(fx.st, ott, '2026-11-01T00:00:00', '2026-11-02T00:00:00', opt)
        assert.strictEqual(rs.length, 2)
        assert.deepStrictEqual([rs[0].commission, rs[0].commissionAsset], [0, ''], 'null 幣別應正規化為空字串')
        assert.deepStrictEqual([rs[1].commission, rs[1].commissionAsset], [0.0072, 'USDT'])
    })

})
