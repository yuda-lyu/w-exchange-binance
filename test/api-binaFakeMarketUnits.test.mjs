import assert from 'assert'
import calcBaseUnitQuantity from 'w-trade-backtest/src/calcBaseUnitQuantity.mjs'
import ott from '../src/ott.mjs'
import webina from '../src/WExchangeBinance.mjs'
import { getContractRuleFromSymbol } from '../src/calcContractUnitsQuantity.mjs'
import { blocked, catchErr, mkFake, startFake, stopFake } from './tools/binaFakeServer.mjs'


//opBinaContractMarketUnits(規則見sgud/rule/rulebook.md之R-UNITS): 進場數量 = units × q0(送單當下之標記價), q0由w-trade-backtest之calcBaseUnitQuantity求得
//交易規則: opt.rule, 未給則由st(digContractQuantity、quantityLow、notional)轉成; 上限: opt.maxNotional(必給)、opt.maxUnits、規則之maxQty; 規則帶symbol須等於st.symbol
//規則與緩衝之有效性與可計算性為buildBaseUnitNotional之判定(訊息之名稱opt); 數字類之輸入收數字字串, 通過即轉為Number後使用
//止損止盈之數量 = 實際成交量(不以當時之價格重算); 輸入與與價格無關之檢測先於任何請求; 定量資訊記於err.state.unit與回傳之unit
//其餘流程與opBinaContractMarket共用(各階段之outcome見api-binaFakeMarket; 站點×結果見api-binaFakeMatrix)
describe('opBinaContractMarketUnits 以單位數定量 (本機假伺服器)', function() {

    before(async () => {
        await startFake()
    })
    after(async () => {
        await stopFake()
        assert.deepStrictEqual(blocked, [], '不得有連外嘗試')
    })

    //上限之測試另給maxNotional; 其餘之案給足夠大之上限
    let opt = { forceTest: true, maxNotional: 1e12 }
    let K_ORDER = 'POST /fapi/v1/order'
    let K_ALGO = 'POST /fapi/v1/algoOrder'
    let isSl = (p) => p.get('type') === 'STOP_MARKET'
    let isTp = (p) => p.get('type') === 'TAKE_PROFIT_MARKET'
    let nTdid = 0
    let newTdid = () => `tdid-u-${Date.now()}-${++nTdid}`
    let runU = (fx, units, o = opt, mode = 'long', tdid = newTdid()) => webina.opBinaContractMarketUnits(fx.st, ott, mode, tdid, units, 0.04, 0.02, o)
    let rej = (code) => ({ status: 400, body: { code, msg: 'x' } })
    let RA = { stepSize: 0.001, minQty: 0.001, minNotional: 20 }
    //進場單被拒(確定未執行): 只取送出之數量, 不等保護單之間隔
    let sentQty = async (fx, units, o = opt) => {
        fx.on(K_ORDER, [{ reply: rej(-2019) }])
        let err = await catchErr(runU(fx, units, o))
        assert.strictEqual(err.outcome, 'NOT_ENTERED')
        assert.strictEqual(fx.count(K_ORDER), 1)
        return fx.reqsOf(K_ORDER)[0].p.quantity
    }
    //拒於標記價之後(未送進場單)
    let assertNotEnteredMark = (err, fx, reason, tag) => {
        assert.strictEqual(err.outcome, 'NOT_ENTERED', tag)
        assert.strictEqual(err.execState, 'notExecuted', tag)
        assert.strictEqual(err.state.stage, 'mark', tag)
        assert.strictEqual(err.state.entry.reason, reason, tag)
        assert.strictEqual(fx.count(K_ORDER), 0, `${tag}: 不送進場單`)
        assert.strictEqual(fx.count(K_ALGO), 0, `${tag}: 不掛保護`)
        assert.strictEqual(err.message, 'opBinaContractMarketUnits failed: NOT_ENTERED', `${tag}: 訊息不帶值`)
    }
    //請求序列之正規化: [端點, 是否簽章, 參數(去時戳與簽章)]; 端點以假伺服器之reqsOf歸類, 未列之端點為'?'
    //  標記價與部位兩個讀取為並行送出(到達之先後不定), 相鄰之此兩者依端點排成固定次序; 其餘請求照到達之次序
    let ENDPOINTS = ['GET /fapi/v1/order', 'POST /fapi/v1/leverage', 'POST /fapi/v1/marginType', 'POST /fapi/v1/positionSide/dual', 'GET /fapi/v1/premiumIndex', 'GET /fapi/v3/positionRisk',
        'POST /fapi/v1/order', 'POST /fapi/v1/algoOrder', 'GET /fapi/v1/algoOrder', 'GET /fapi/v1/openAlgoOrders', 'GET /fapi/v1/openOrders']
    let PARALLEL = ['GET /fapi/v1/premiumIndex', 'GET /fapi/v3/positionRisk']
    let seqOf = (fx) => {
        let s = fx.reqs.map((r) => {
            let p = { ...r.p }
            delete p.timestamp
            delete p.signature
            return [ENDPOINTS.find((e) => fx.reqsOf(e).includes(r)) || '?', r.signed, p]
        })
        let out = []
        for (let i = 0; i < s.length; i++) {
            if (PARALLEL.includes(s[i][0]) && i + 1 < s.length && PARALLEL.includes(s[i + 1][0]) && s[i][0] !== s[i + 1][0]) {
                out.push(...[s[i], s[i + 1]].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
                i++
                continue
            }
            out.push(s[i])
        }
        return out
    }

    //對照表: [st之交易規則(由getContractRule轉成), 標記價(交易所之字串), 數量字串]
    let STA = { digContractQuantity: 3, quantityLow: 0.001, notional: 20 }
    let STB = { digContractQuantity: 3, quantityLow: 0.001, notional: 50 }
    let STC = { digContractQuantity: 1, quantityLow: 1, notional: 5 }
    let ROWS = [
        [STA, '2000.00', '0.011'],
        [STA, '2001.00', '0.011'],
        [STA, '1999.00', '0.012'],
        [STA, '4400.00', '0.005'],
        [STA, '4399.00', '0.006'],
        [STB, '100000.00', '0.001'],
        [STB, '55000.00', '0.001'],
        [STB, '54999.00', '0.002'],
        [STB, '16000.00', '0.004'],
        [STC, '10.00', '1.0'],
    ]

    for (let mode of ['long', 'short']) {

        it(`成功路徑(${mode}): 進場數量 = units × q0(標記價), 止損止盈之數量同進場, 回傳帶units、unit與計畫名義`, async () => {
            let fx = mkFake()
            let tdid = newTdid()
            //標記價3000.00、規則甲: k = ceil(22 / 3) = 8, units 2 ⇒ 0.016(名義48)
            let r = await runU(fx, 2, { ...opt, maxNotional: 48 }, mode, tdid)
            assert.strictEqual(fx.count(K_ORDER), 1)
            assert.strictEqual(fx.count(K_ALGO), 2)
            let pEntry = fx.reqsOf(K_ORDER)[0].p
            assert.strictEqual(pEntry.quantity, '0.016')
            assert.strictEqual(pEntry.side, mode === 'long' ? 'BUY' : 'SELL')
            assert.strictEqual(pEntry.type, 'MARKET')
            assert.strictEqual(fx.reqsOf(K_ALGO, isSl)[0].p.quantity, '0.016')
            assert.strictEqual(fx.reqsOf(K_ALGO, isTp)[0].p.quantity, '0.016')
            assert.strictEqual(r.quantity, '0.016')
            assert.strictEqual(r.units, 2)
            assert.strictEqual(r.uTrade, '48.00', '計畫名義 = 數量 × 標記價')
            assert.strictEqual(r.uTradeReal, '48.00')
            assert.strictEqual(r.priceStart, '3000.00')
            assert.strictEqual(r.idTrade, tdid)
            //本次之定量資訊(名目恰等於上限 ⇒ 照送)
            assert.deepStrictEqual(r.unit, { units: 2, rule: RA, buffer: 0.1, maxNotional: 48, maxUnits: null, k: 8, q0: 0.008, n0: 24, quantityStr: '0.016', notional: 48 })
            //回傳之鍵: 同opBinaContractMarket, 末尾另帶units、unit
            let fx2 = mkFake()
            let r2 = await webina.opBinaContractMarket(fx2.st, ott, mode, newTdid(), 22, 0.04, 0.02, { forceTest: true })
            assert.deepStrictEqual(Object.getOwnPropertyNames(r), [...Object.getOwnPropertyNames(r2), 'units', 'unit'])
            assert.strictEqual(r2.units, undefined)
            assert.strictEqual(r2.unit, undefined)
        })

    }

    it('數字字串之輸入(K4、K7): units、opt.maxNotional、opt.maxUnits、opt.rule、opt.buffer給數字字串時, 送出之數量與定量資訊同數字輸入, 定量資訊所記為轉換後之Number', async () => {
        let fxN = mkFake()
        let qN = await sentQty(fxN, 2, { ...opt, maxNotional: 48, maxUnits: 4, rule: RA, buffer: 0.1 })
        let fxS = mkFake()
        fxS.on(K_ORDER, [{ reply: rej(-2019) }])
        let err = await catchErr(runU(fxS, ' 2 ', { ...opt, maxNotional: '48', maxUnits: '4', rule: { stepSize: '0.001', minQty: '0.001', minNotional: '20' }, buffer: '0.1' }))
        assert.strictEqual(err.outcome, 'NOT_ENTERED')
        assert.strictEqual(fxS.reqsOf(K_ORDER)[0].p.quantity, qN)
        assert.strictEqual(qN, '0.016')
        assert.deepStrictEqual(err.state.unit, { units: 2, rule: RA, buffer: 0.1, maxNotional: 48, maxUnits: 4, k: 8, q0: 0.008, n0: 24, quantityStr: '0.016', notional: 48 })
        //整數值之數字字串('22.00'、'1e1')為有效整數(§3.1), 依其值定量
        for (let [v, qs] of [['3', '0.024'], ['22.00', '0.176'], ['1e1', '0.080']]) {
            let fx = mkFake()
            assert.strictEqual(await sentQty(fx, v), qs, `units ${v}`)
        }
    })

    it('兩入口之請求序列相同: 同tdid、同標記價、同數量(24u 與 1 單位皆為0.008)、含帳戶設定 ⇒ 方法、路徑、參數鍵與值、次序皆同(只去時戳與簽章)', async () => {
        let o = { forceTest: true, setLever: true, setCrossMargin: true, setDualSide: true }
        let tdid = newTdid()
        let fxA = mkFake()
        let rA = await webina.opBinaContractMarket(fxA.st, ott, 'long', tdid, 24, 0.04, 0.02, o)
        let fxB = mkFake()
        let rB = await webina.opBinaContractMarketUnits(fxB.st, ott, 'long', tdid, 1, 0.04, 0.02, { ...o, maxNotional: 30 })
        assert.strictEqual(rA.quantity, '0.008')
        assert.strictEqual(rB.quantity, '0.008')
        let sA = seqOf(fxA)
        let sB = seqOf(fxB)
        assert.ok(sA.length >= 8, `前提: 請求數 ${sA.length}`)
        assert.ok(sA.every(([e]) => e !== '?'), '前提: 各請求之端點皆已歸類')
        assert.ok(sA.some(([, signed]) => signed) && sA.some(([, signed]) => !signed), '前提: 簽章與不簽章之請求皆有')
        assert.deepStrictEqual(sB, sA)
        //正規化之前提: 並行之兩讀取之到達次序對調時, 正規化後之序列不變
        let iMark = fxA.reqs.indexOf(fxA.reqsOf('GET /fapi/v1/premiumIndex')[0])
        let iPos = fxA.reqs.indexOf(fxA.reqsOf('GET /fapi/v3/positionRisk')[0])
        assert.strictEqual(Math.abs(iMark - iPos), 1, '前提: 兩讀取相鄰')
        let swapped = [...fxA.reqs]
        swapped[iMark] = fxA.reqs[iPos]
        swapped[iPos] = fxA.reqs[iMark]
        assert.deepStrictEqual(seqOf({ reqs: swapped, reqsOf: fxA.reqsOf }), sA)
        //鑑別前提: 數量不同時序列即不同(數量確在比對之內)
        let fxC = mkFake()
        await webina.opBinaContractMarketUnits(fxC.st, ott, 'long', tdid, 2, 0.04, 0.02, { ...o, maxNotional: 60 })
        assert.notDeepStrictEqual(seqOf(fxC), sA)
    })

    it('對照表十列: 標記價為各列之價時, 送出之數量逐列相符(交易規則由st轉成)', async () => {
        for (let [stRule, mark, qs] of ROWS) {
            let fx = mkFake(stRule)
            fx.ex.markPrice = mark
            assert.strictEqual(await sentQty(fx, 1), qs, `mark ${mark}`)
        }
    })

    it('與calcBaseUnitQuantity逐位相同: 同一標記價、規則、緩衝、單位數下送出之數量 = 其quantityStr(opt.rule三種、緩衝三種、單位數四種、標記價隨機)', async () => {
        let rules = [
            { stepSize: 0.001, minQty: 0.001, minNotional: 20 },
            { stepSize: '0.01', minQty: '0.05', minNotional: '5' },
            { stepSize: 1, minQty: 1, minNotional: 5 },
        ]
        let seed = 7
        let rnd = () => {
            seed = (seed * 16807) % 2147483647
            return seed / 2147483647
        }
        let n = 0
        for (let rule of rules) {
            for (let buffer of [undefined, 0, 0.25]) {
                for (let units of [1, 2, 7, 30]) {
                    let mark = (1 + rnd() * 99999).toFixed(2)
                    let fx = mkFake()
                    fx.ex.markPrice = mark
                    let o = { ...opt, rule, buffer }
                    let q = await sentQty(fx, units, o)
                    assert.strictEqual(q, calcBaseUnitQuantity(mark, rule, { buffer: buffer === undefined ? 0.1 : buffer, units }).quantityStr, `mark ${mark} rule ${JSON.stringify(rule)} buffer ${buffer} units ${units}`)
                    n++
                }
            }
        }
        assert.strictEqual(n, 36)
    })

    it('每單名目之上限之下界(送任何請求之前): 誤把金額當單位數(units 22)且給了三種帳戶設定 ⇒ 22 × 20 × 1.1 = 484 > 上限30 ⇒ 拋, 請求0次', async () => {
        let fx = mkFake()
        let o = { ...opt, maxNotional: 30, setLever: true, setCrossMargin: true, setDualSide: true }
        await assert.rejects(runU(fx, 22, o), { message: 'invalid units or opt.maxNotional: notional must not exceed opt.maxNotional at any price' })
        //金額以字串給(表單來源)亦同
        await assert.rejects(runU(fx, '22', { ...o, maxNotional: '30' }), { message: 'invalid units or opt.maxNotional: notional must not exceed opt.maxNotional at any price' })
        assert.strictEqual(fx.reqs.length, 0, '請求須為0次(含閘、帳戶設定、標記價)')
        //單位數極大(安全整數之上限)⇒ 同樣於送單前擋下
        let fx2 = mkFake()
        await assert.rejects(runU(fx2, 9007199254740991, { ...opt, maxNotional: 1e6, setLever: true }), { message: 'invalid units or opt.maxNotional: notional must not exceed opt.maxNotional at any price' })
        assert.strictEqual(fx2.reqs.length, 0)
    })

    it('每單名目之上限恰等於下界 ⇒ 不誤拒(精確十進位; 浮點之50 × 1.1 > 55), 照常進到標記價後之比較: 名目恰等於照送、超過即不送', async () => {
        let RB = { stepSize: 0.001, minQty: 0.001, minNotional: 50 }
        assert.ok(1 * 50 * (1 + 0.1) > 55 && 2 * 50 * (1 + 0.1) > 110, '鑑別前提: 浮點計算之下界大於上限')
        //最小名義價值50: 上限55 = 1 × 50 × 1.1、標記價55000.00時名目恰55 ⇒ 送; 上限110 = 2 × 55 ⇒ 送
        let fx = mkFake()
        fx.ex.markPrice = '55000.00'
        assert.strictEqual(await sentQty(fx, 1, { ...opt, rule: RB, maxNotional: 55 }), '0.001')
        let fx2 = mkFake()
        fx2.ex.markPrice = '55000.00'
        assert.strictEqual(await sentQty(fx2, 2, { ...opt, rule: RB, maxNotional: 110 }), '0.002')
        //最小名義價值20: 上限22 = 1 × 22、標記價2000.00時名目恰22 ⇒ 送
        let fx2b = mkFake()
        fx2b.ex.markPrice = '2000.00'
        assert.strictEqual(await sentQty(fx2b, 1, { ...opt, maxNotional: 22 }), '0.011')
        //上限22、標記價3000.00: 下界通過而名目24 > 22 ⇒ 不送進場單(已送閘與讀取)
        let fx3 = mkFake()
        let err = await catchErr(runU(fx3, 1, { ...opt, maxNotional: 22 }))
        assertNotEnteredMark(err, fx3, 'notionalExceeded', '上限22、名目24')
        assert.ok(fx3.count('GET /fapi/v1/premiumIndex') === 1, '前提: 已進到標記價')
    })

    it('每單名目之上限(標記價之後): 下界通過而計畫名義超過 ⇒ 不送進場單, 計算值記於err.state.unit; 恰等於上限照送', async () => {
        //標記價3000.00、1單位: 名目24; 上限23.99(下界22通過)⇒ 拒
        let fx = mkFake()
        let err = await catchErr(runU(fx, 1, { ...opt, maxNotional: 23.99 }))
        assertNotEnteredMark(err, fx, 'notionalExceeded', '23.99')
        assert.deepStrictEqual([err.state.unit.units, err.state.unit.q0, err.state.unit.quantityStr, err.state.unit.notional, err.state.unit.maxNotional], [1, 0.008, '0.008', 24, 23.99])
        //3單位、上限70(下界66通過): 名目72 ⇒ 拒
        let fx2 = mkFake()
        assertNotEnteredMark(await catchErr(runU(fx2, 3, { ...opt, maxNotional: 70 })), fx2, 'notionalExceeded', '3 units')
        //恰等於 ⇒ 送(上限以字串給亦同)
        let fx3 = mkFake()
        assert.strictEqual(await sentQty(fx3, 1, { ...opt, maxNotional: 24 }), '0.008')
        let fx4 = mkFake()
        assert.strictEqual(await sentQty(fx4, 1, { ...opt, maxNotional: '24' }), '0.008')
    })

    it('單位數之上限(opt.maxUnits): units超過即拋, 請求0次; 恰等於照送', async () => {
        let fx = mkFake()
        await assert.rejects(runU(fx, 5, { ...opt, maxUnits: 4 }), { message: 'invalid units: must not exceed opt.maxUnits' })
        await assert.rejects(runU(fx, '5', { ...opt, maxUnits: '4' }), { message: 'invalid units: must not exceed opt.maxUnits' })
        assert.strictEqual(fx.reqs.length, 0)
        let fx2 = mkFake()
        assert.strictEqual(await sentQty(fx2, 4, { ...opt, maxUnits: 4 }), '0.032')
    })

    it('單筆數量上限(規則之maxQty): 數量超過即不送進場單; 恰等於照送; 未帶者不檢', async () => {
        let fx = mkFake()
        let err = await catchErr(runU(fx, 2, { ...opt, rule: { ...RA, maxQty: 0.015 } }))
        assertNotEnteredMark(err, fx, 'quantityExceeded', 'maxQty 0.015')
        assert.strictEqual(err.state.unit.quantityStr, '0.016')
        let fx2 = mkFake()
        assert.strictEqual(await sentQty(fx2, 2, { ...opt, rule: { ...RA, maxQty: '0.016' } }), '0.016')
        let fx3 = mkFake()
        assert.strictEqual(await sentQty(fx3, 2, { ...opt, rule: RA }), '0.016')
        //下界(送任何請求之前): 2 × 最小合法數量0.001 = 0.002 > maxQty 0.0015 ⇒ 拋, 請求0次(含帳戶設定)
        let fx4 = mkFake()
        await assert.rejects(runU(fx4, 2, { ...opt, rule: { ...RA, maxQty: 0.0015 }, setLever: true }), { message: 'invalid units or opt.rule.maxQty: quantity must not exceed opt.rule.maxQty at any price' })
        assert.strictEqual(fx4.reqs.length, 0)
        //下界恰等於maxQty(步長0.1、最小數量0.1、3單位 ⇒ 0.3; 浮點之3 × 0.1 > 0.3)⇒ 不誤拒; 標記價100.00時k = max(1, ceil(5.5 / 10)) = 1 ⇒ 0.3 ⇒ 送
        assert.ok(3 * 0.1 > 0.3, '鑑別前提: 浮點計算之下界大於上限')
        let fx5 = mkFake()
        fx5.ex.markPrice = '100.00'
        assert.strictEqual(await sentQty(fx5, 3, { ...opt, rule: { stepSize: 0.1, minQty: 0.1, minNotional: 5, maxQty: 0.3 } }), '0.3')
        //同規則、標記價10.00: k = ceil(5.5 / 1) = 6 ⇒ 1.8 > 0.3 ⇒ 下界通過而標記價後超過 ⇒ 不送進場單
        let fx6 = mkFake()
        fx6.ex.markPrice = '10.00'
        assertNotEnteredMark(await catchErr(runU(fx6, 3, { ...opt, rule: { stepSize: 0.1, minQty: 0.1, minNotional: 5, maxQty: 0.3 } })), fx6, 'quantityExceeded', 'maxQty 0.3 @10')
    })

    it('規則與標的之綁定: 規則帶symbol而不等於st.symbol ⇒ 拋, 請求0次; 相等照送; 未帶者照收', async () => {
        let fx = mkFake()
        await assert.rejects(runU(fx, 1, { ...opt, rule: { ...RA, symbol: 'BTCUSDT' } }), { message: 'invalid opt.rule.symbol: must equal st.symbol' })
        assert.strictEqual(fx.reqs.length, 0)
        let fx2 = mkFake()
        assert.strictEqual(await sentQty(fx2, 1, { ...opt, rule: { ...RA, symbol: 'ETHUSDT' } }), '0.008')
        let fx3 = mkFake()
        assert.strictEqual(await sentQty(fx3, 1, { ...opt, rule: RA }), '0.008')
    })

    it('端到端: 商品資訊(假伺服器)→ getContractRuleFromSymbol → opt.rule → 送單之數量、單筆上限與標的之綁定', async () => {
        let symbInfo = {
            symbols: [{
                symbol: 'ETHUSDT',
                status: 'TRADING',
                pricePrecision: 2,
                quantityPrecision: 2,
                filters: [
                    { filterType: 'PRICE_FILTER', minPrice: '0.01', maxPrice: '1000000', tickSize: '0.01' },
                    { filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001', maxQty: '10000' },
                    { filterType: 'MARKET_LOT_SIZE', stepSize: '0.01', minQty: '0.01', maxQty: '0.05' },
                    { filterType: 'MIN_NOTIONAL', notional: '50' },
                ],
            }],
        }
        let fx = mkFake()
        fx.on('GET /fapi/v1/exchangeInfo', [{ reply: { status: 200, body: symbInfo } }])
        let rule = getContractRuleFromSymbol(await webina.opBinaContractQuerySymbolInfor(fx.st, 'ETHUSDT', opt))
        assert.deepStrictEqual(rule, { stepSize: 0.01, minQty: 0.01, minNotional: 50, maxQty: 0.05, symbol: 'ETHUSDT' })
        //標記價3000.00: k = max(1, ceil(55 / 30)) = 2 ⇒ 0.02(與st之規則甲所得之0.008不同)
        fx.on(K_ORDER, [{ reply: rej(-2019) }])
        await catchErr(runU(fx, 1, { ...opt, rule }))
        assert.strictEqual(fx.reqsOf(K_ORDER)[0].p.quantity, '0.02')
        //3單位 = 0.06 > maxQty 0.05 ⇒ 不送
        let fx2 = mkFake()
        assertNotEnteredMark(await catchErr(runU(fx2, 3, { ...opt, rule })), fx2, 'quantityExceeded', '3 units')
        //他標的之設定物件 ⇒ 標的不符即拒
        let fx3 = mkFake({ symbol: 'BTCUSDT' })
        await assert.rejects(runU(fx3, 1, { ...opt, rule }), { message: 'invalid opt.rule.symbol: must equal st.symbol' })
        assert.strictEqual(fx3.reqs.length, 0)
    })

    it('止損止盈之數量 = 進場之實際成交量, 不以掛單時之標記價重算(進場後標記價大跌)', async () => {
        let fx = mkFake()
        //進場時3000.00(0.008), 成交後標記價改為1500.00(若重算為0.015)
        fx.on(K_ORDER, [{
            after: ({ ex }) => {
                ex.markPrice = '1500.00'
            },
        }])
        let r = await runU(fx, 1)
        assert.strictEqual(fx.reqsOf(K_ORDER)[0].p.quantity, '0.008')
        assert.strictEqual(fx.reqsOf(K_ALGO, isSl)[0].p.quantity, '0.008')
        assert.strictEqual(fx.reqsOf(K_ALGO, isTp)[0].p.quantity, '0.008')
        assert.strictEqual(r.quantity, '0.008')
        assert.strictEqual(fx.ex.markPrice, '1500.00', '前提: 掛保護時標記價已變')
        assert.strictEqual(calcBaseUnitQuantity('1500.00', RA).quantityStr, '0.015', '鑑別前提: 以新價重算會不同')
    })

    it('部分成交: 止損止盈與回傳quantity皆用實際成交量, uTradeReal以成交量計, uTrade仍為全量之計畫名義', async () => {
        let fx = mkFake()
        fx.on(K_ORDER, [{
            exec: false,
            reply: ({ ex, p }) => {
                let o = ex.addOrder({ clientOrderId: p.get('newClientOrderId'), origQty: p.get('quantity'), executedQty: '0.003', status: 'EXPIRED', side: p.get('side'), positionSide: p.get('positionSide') })
                ex.addPos(p.get('positionSide'), 0.003)
                return { status: 200, body: { ...o } }
            },
        }])
        let r = await runU(fx, 1)
        assert.strictEqual(fx.reqsOf(K_ORDER)[0].p.quantity, '0.008')
        assert.strictEqual(r.quantity, '0.003')
        assert.strictEqual(fx.reqsOf(K_ALGO, isSl)[0].p.quantity, '0.003')
        assert.strictEqual(fx.reqsOf(K_ALGO, isTp)[0].p.quantity, '0.003')
        assert.strictEqual(Number(r.uTradeReal), 9)
        assert.strictEqual(r.uTrade, '24.00')
        assert.strictEqual(r.unit.quantityStr, '0.008')
    })

    it('opt.rule給了即用之(優先於st), 此時st不需quantityLow與notional', async () => {
        //st為規則甲, opt.rule為步長0.01、最小數量0.01、最小名義價值50: 3000.00時k = max(1, ceil(55 / 30)) = 2 ⇒ 0.02
        let fx = mkFake()
        assert.strictEqual(await sentQty(fx, 1, { ...opt, rule: { stepSize: 0.01, minQty: 0.01, minNotional: 50 } }), '0.02')
        //st不含quantityLow、notional、digContractQuantity亦可
        let fx2 = mkFake()
        delete fx2.st.quantityLow
        delete fx2.st.notional
        delete fx2.st.digContractQuantity
        assert.strictEqual(await sentQty(fx2, 3, { ...opt, rule: { stepSize: '0.001', minQty: '0.001', minNotional: '20', asOf: 'x' } }), '0.024')
        //opt.rule為null視為未給, 由st轉成
        let fx3 = mkFake()
        assert.strictEqual(await sentQty(fx3, 1, { ...opt, rule: null }), '0.008')
    })

    it('opt.buffer: 未給或null為BUFFER_DEFAULT(0.1); 給0、數字字串、上限1亦用之(門檻 = minNotional × (1 + buffer))', async () => {
        //標記價2000.00、規則甲: buffer 0.1 ⇒ 門檻22恰11格; 0 ⇒ 20恰10格; 0.25 ⇒ 25取13格; 1 ⇒ 40恰20格
        for (let [buffer, qs] of [[undefined, '0.011'], [null, '0.011'], [0, '0.010'], ['0', '0.010'], [0.25, '0.013'], ['0.25', '0.013'], [1, '0.020'], ['1', '0.020']]) {
            let fx = mkFake()
            fx.ex.markPrice = '2000.00'
            let o = buffer === undefined ? opt : { ...opt, buffer }
            assert.strictEqual(await sentQty(fx, 1, o), qs, `buffer ${buffer}`)
        }
    })

    it('不使用下單金額與st.uTrade(依金額定量時之下限不適用)', async () => {
        //st.uTrade極大: opBinaContractMarket拒絕, opBinaContractMarketUnits照常
        let fx = mkFake({ uTrade: 1e9 })
        await assert.rejects(webina.opBinaContractMarket(fx.st, ott, 'long', newTdid(), 22, 0.04, 0.02, { forceTest: true }), { message: 'invalid uTrade: must not be less than st.uTrade' })
        assert.strictEqual(fx.reqs.length, 0)
        assert.strictEqual(await sentQty(fx, 1), '0.008')
    })

    it('輸入檢測先於任何請求: units非有效正整數、上限缺或無效、opt.rule或opt.buffer給了而無效、st之交易規則缺或無效、規則不可計算 ⇒ 拋錯, 請求0次, 訊息不回顯值', async () => {
        class Holder {}
        let fx = mkFake()
        let cases = []
        for (let v of [0, -1, 1.5, '1.5', '0', '-3', 2 ** 53, '9007199254740993', 'ECHO-9Q', '', NaN, Infinity, null, undefined, true, [], {}, 10n, Object(3)]) {
            cases.push([`units ${typeof v === 'bigint' ? 'bigint' : String(v)}`, () => runU(fx, v), 'invalid units: must be a positive integer'])
        }
        for (let o of [{ forceTest: true }, { forceTest: true, maxNotional: null }, { forceTest: true, maxNotional: 0 }, { forceTest: true, maxNotional: -1 }, { forceTest: true, maxNotional: '0' }, { forceTest: true, maxNotional: 'ECHO-9Q' }, { forceTest: true, maxNotional: '1e400' }, { forceTest: true, maxNotional: NaN }, { forceTest: true, maxNotional: Infinity }, { forceTest: true, maxNotional: true }]) {
            cases.push([`maxNotional ${String(o.maxNotional)}`, () => runU(fx, 1, o), 'invalid opt.maxNotional: must be a positive number'])
        }
        cases.push(['opt null', () => runU(fx, 1, null), 'invalid opt.maxNotional: must be a positive number'])
        for (let maxUnits of [0, -1, 1.5, '1.5', 'ECHO-9Q', NaN, true]) {
            cases.push([`maxUnits ${String(maxUnits)}`, () => runU(fx, 1, { ...opt, maxUnits }), 'invalid opt.maxUnits: must be a positive integer'])
        }
        for (let rule of ['ECHO-9Q', 1, [], new Date(0), Object.assign(new Holder(), RA)]) {
            cases.push([`rule ${String(rule)}`, () => runU(fx, 1, { ...opt, rule }), 'invalid opt.rule: must be an object'])
        }
        for (let [k, v] of [['stepSize', 0], ['stepSize', 'ECHO-9Q'], ['minQty', -0.001], ['minQty', undefined], ['minNotional', NaN], ['minNotional', '0']]) {
            let rule = { ...RA, [k]: v }
            cases.push([`rule.${k} ${String(v)}`, () => runU(fx, 1, { ...opt, rule }), `invalid opt.rule.${k}: must be a positive number`])
        }
        cases.push(['rule.maxQty 0', () => runU(fx, 1, { ...opt, rule: { ...RA, maxQty: 0 } }), 'invalid opt.rule.maxQty: must be a positive number'])
        cases.push(['rule.symbol 空', () => runU(fx, 1, { ...opt, rule: { ...RA, symbol: '' } }), 'invalid opt.rule.symbol: must be a non-empty string'])
        cases.push(['rule 不可計算', () => runU(fx, 1, { ...opt, rule: { stepSize: 1e-30, minQty: 1, minNotional: 5 } }), 'invalid opt: step count k must not exceed Number.MAX_SAFE_INTEGER'])
        //規則與單位數合起來不可計算(數量超出雙精度範圍; 上限之下界通過): 單位數亦交判定
        cases.push(['rule×units 不可計算', () => runU(fx, 9007199254740991, { ...opt, maxNotional: 1e300, rule: { stepSize: 1e300, minQty: 1e300, minNotional: 5 } }), 'invalid opt: quantity and notional must be finite numbers'])
        //緩衝: 回測套件之判定(非負之有效數字)與本套件之較嚴(≤ 1)
        for (let buffer of [-0.1, '-0.1', 'ECHO-9Q', NaN, Infinity, true, {}, []]) {
            cases.push([`buffer ${String(buffer)}`, () => runU(fx, 1, { ...opt, buffer }), 'invalid opt.buffer: must be a non-negative number'])
        }
        for (let buffer of [1.0000001, 10, '10']) {
            cases.push([`buffer ${String(buffer)}`, () => runU(fx, 1, { ...opt, buffer }), 'invalid opt.buffer: must be a number from 0 to 1'])
        }
        for (let [k, v, msg] of [
            ['digContractQuantity', undefined, 'invalid st.digContractQuantity: must be an integer from 0 to 100'],
            ['digContractQuantity', 'ECHO-9Q', 'invalid st.digContractQuantity: must be an integer from 0 to 100'],
            ['digContractQuantity', 101, 'invalid st.digContractQuantity: must be an integer from 0 to 100'],
            ['quantityLow', undefined, 'invalid st.quantityLow: must be a positive number'],
            ['quantityLow', 0, 'invalid st.quantityLow: must be a positive number'],
            ['notional', undefined, 'invalid st.notional: must be a positive number'],
            ['notional', 'ECHO-9Q', 'invalid st.notional: must be a positive number'],
            //由st轉成之規則不可計算: 訊息之名稱為opt(buildBaseUnitNotional以單一名稱涵蓋規則與緩衝; 見R-UNITS-04)
            ['digContractQuantity', 20, 'invalid opt: step count k must not exceed Number.MAX_SAFE_INTEGER'],
        ]) {
            let st = { ...fx.st, [k]: v }
            cases.push([`st.${k} ${String(v)}`, () => webina.opBinaContractMarketUnits(st, ott, 'long', newTdid(), 1, 0.04, 0.02, { ...opt, setLever: true, setCrossMargin: true }), msg])
        }
        for (let [name, fn, msg] of cases) {
            let err = await catchErr(fn())
            assert.strictEqual(err.message, msg, name)
            assert.ok(!/ECHO-9Q/.test(err.message), `${name}: 不回顯值`)
        }
        assert.strictEqual(fx.reqs.length, 0, '請求須為0次(含帳戶設定)')
        //檢測之次序: units先於止盈止損
        let err = await catchErr(webina.opBinaContractMarketUnits(fx.st, ott, 'long', newTdid(), 0, 0.3, 0.2, opt))
        assert.strictEqual(err.message, 'invalid units: must be a positive integer')
    })

    it('依標記價計算失敗(格數超過安全整數、標記價為0或負): NOT_ENTERED(stage mark、reason quantityInvalid), 不送進場單', async () => {
        let fx = mkFake()
        fx.ex.markPrice = '0.0000000001'
        assertNotEnteredMark(await catchErr(runU(fx, 1, { ...opt, rule: { stepSize: 1e-8, minQty: 1e-8, minNotional: 5 } })), fx, 'quantityInvalid', '格數超限')
        for (let mark of ['0', '0.00', '-5']) {
            let fx2 = mkFake()
            fx2.ex.markPrice = mark
            assertNotEnteredMark(await catchErr(runU(fx2, 1)), fx2, 'quantityInvalid', `mark ${mark}`)
        }
    })

    it('帳戶設定之後定量失敗(下界通過而標記價後超過上限): 已送閘與帳戶設定、標記價與部位, 未送進場單與保護單(請求序列)', async () => {
        //1單位: 下界22 ≤ 上限23; 標記價3000.00之名目24 > 23
        let fx = mkFake()
        let err = await catchErr(runU(fx, 1, { ...opt, maxNotional: 23, setLever: true, setCrossMargin: true, setDualSide: true }))
        assertNotEnteredMark(err, fx, 'notionalExceeded', 'setup')
        assert.deepStrictEqual(Object.getOwnPropertyNames(err.state.setup).sort(), ['crossMargin', 'dualSide', 'lever'])
        let eps = seqOf(fx).map(([e]) => e)
        assert.deepStrictEqual(eps.slice(0, 4), ['GET /fapi/v1/order', 'POST /fapi/v1/leverage', 'POST /fapi/v1/marginType', 'POST /fapi/v1/positionSide/dual'])
        assert.deepStrictEqual(eps.slice(4).sort(), ['GET /fapi/v1/premiumIndex', 'GET /fapi/v3/positionRisk'])
    })

    it('entryDeadlineMs: 已過(含載入之時間)⇒ NOT_ENTERED{deadline}, 不送進場單', async () => {
        let fx = mkFake()
        let err = await catchErr(runU(fx, 1, { ...opt, entryDeadlineMs: 0.001 }))
        assert.strictEqual(err.outcome, 'NOT_ENTERED')
        assert.strictEqual(err.state.stage, 'deadline')
        assert.strictEqual(fx.count(K_ORDER), 0)
        assert.strictEqual(err.state.unit.quantityStr, '0.008', '定量已完成')
    })

    it('同程序在途防護與opBinaContractMarket共用: 三種並行之次序皆只送1張進場單, 後者得TDID_IN_FLIGHT(未送單)', async () => {
        let both = (pa, pb) => Promise.all([pa.then((r) => ({ r }), (err) => ({ err })), pb.then((r) => ({ r }), (err) => ({ err }))])
        //Market先呼叫: Market於第一個請求之前即登記
        let fx = mkFake()
        let tdid = newTdid()
        let [a, b] = await both(webina.opBinaContractMarket(fx.st, ott, 'long', tdid, 22, 0.04, 0.02, { forceTest: true }), runU(fx, 1, opt, 'long', tdid))
        assert.ok(a.r)
        assert.strictEqual(b.err.outcome, 'TDID_IN_FLIGHT')
        assert.strictEqual(b.err.state.sentThisCall, false)
        assert.match(b.err.message, /^opBinaContractMarketUnits failed: TDID_IN_FLIGHT$/)
        assert.strictEqual(fx.count(K_ORDER), 1)
        //新入口先呼叫而Market後呼叫: 新入口於載入之後才登記 ⇒ Market先登記
        let fx2 = mkFake()
        let tdid2 = newTdid()
        let [c, d] = await both(runU(fx2, 1, opt, 'long', tdid2), webina.opBinaContractMarket(fx2.st, ott, 'long', tdid2, 22, 0.04, 0.02, { forceTest: true }))
        assert.strictEqual([c, d].filter((x) => x.r).length, 1)
        assert.strictEqual([c, d].filter((x) => x.err && x.err.outcome === 'TDID_IN_FLIGHT').length, 1)
        assert.strictEqual(fx2.count(K_ORDER), 1)
        //新入口與新入口
        let fx3 = mkFake()
        let tdid3 = newTdid()
        let [e, f] = await both(runU(fx3, 1, opt, 'long', tdid3), runU(fx3, 2, opt, 'long', tdid3))
        assert.strictEqual([e, f].filter((x) => x.r).length, 1)
        assert.strictEqual([e, f].filter((x) => x.err && x.err.outcome === 'TDID_IN_FLIGHT').length, 1)
        assert.strictEqual(fx3.count(K_ORDER), 1)
    })

    it('依金額定量之錯誤之state不帶unit; 內部共用之本體不自聚合入口匯出', async () => {
        let fx = mkFake()
        fx.on(K_ORDER, [{ reply: rej(-2019) }])
        let err = await catchErr(webina.opBinaContractMarket(fx.st, ott, 'long', newTdid(), 22, 0.04, 0.02, { forceTest: true }))
        assert.strictEqual(err.outcome, 'NOT_ENTERED')
        assert.strictEqual(Object.prototype.hasOwnProperty.call(err.state, 'unit'), false)
        assert.strictEqual(webina.runContractMarket, undefined)
        assert.strictEqual(typeof webina.opBinaContractMarketUnits, 'function')
    })

})
