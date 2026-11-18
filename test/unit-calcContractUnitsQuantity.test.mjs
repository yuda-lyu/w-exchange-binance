import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { fileURLToPath } from 'url'
import calcBaseUnitQuantity from 'w-trade-backtest/src/calcBaseUnitQuantity.mjs'
import buildBaseUnitNotional from 'w-trade-backtest/src/buildBaseUnitNotional.mjs'
import calcContractQuantity from '../src/calcContractQuantity.mjs'
import calcContractUnitsQuantity, { BUFFER_DEFAULT, BUFFER_MAX, checkContractBounds, checkContractMaxNotional, checkContractMaxUnits, checkContractRuleBuffer, checkContractUnits, getContractRule, getContractRuleFromSymbol, loadBuildBaseUnitNotional, loadCalcBaseUnitQuantity } from '../src/calcContractUnitsQuantity.mjs'
import { blocked } from './tools/binaNetGuard.mjs'


//以單位數定量之數量計算與送單前之檢測(不連網; 規則見sgud/rule/rulebook.md之R-UNITS)
//  q0 = k × stepSize, k = max(⌈minQty/stepSize⌉, ⌈minNotional×(1+buffer)/(price×stepSize)⌉), 數量 = units × q0(R-UNITS-01)
//  數量之比對一律以對照表十列或本檔獨立之整數算式(BigInt之精確分數, 不共用src與回測套件之轉換)為準, 不以「轉呼叫者對被轉呼叫之同一函數」比對
//  交易規則與緩衝之有效性與可計算性為回測套件之buildBaseUnitNotional之判定(R-UNITS-04, 主控裁定), 故該部分以「本套件之判定與訊息 = buildBaseUnitNotional之判定與訊息」斷言接線; 本套件只另做較嚴之檢查
describe('以單位數定量 calcContractUnitsQuantity、getContractRule、getContractRuleFromSymbol、送單前之檢測 (不連網)', function() {
    this.timeout(180000)

    after(() => {
        assert.deepStrictEqual(blocked, [], '不得有連外嘗試')
    })

    let fdRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

    //規則甲(步長0.001、最小數量0.001、最小名義價值20; 門檻22)、規則乙(0.001、0.001、50; 門檻55)、規則丙(0.1、1、5)
    let RA = { stepSize: 0.001, minQty: 0.001, minNotional: 20 }
    let RB = { stepSize: 0.001, minQty: 0.001, minNotional: 50 }
    let RC = { stepSize: 0.1, minQty: 1, minNotional: 5 }

    //對照表: [規則, 設定物件(由getContractRule轉成同一規則), 進場價, k, q0, n0, 數量字串]
    let STA = { digContractQuantity: 3, quantityLow: 0.001, notional: 20 }
    let STB = { digContractQuantity: 3, quantityLow: 0.001, notional: 50 }
    let STC = { digContractQuantity: 1, quantityLow: 1, notional: 5 }
    let ROWS = [
        [RA, STA, 2000, 11, 0.011, 22, '0.011'], //恰等於門檻, 不多取一格
        [RA, STA, 2001, 11, 0.011, 22.011, '0.011'],
        [RA, STA, 1999, 12, 0.012, 23.988, '0.012'], //11格為21.989<22
        [RA, STA, 4400, 5, 0.005, 22, '0.005'], //邊界
        [RA, STA, 4399, 6, 0.006, 26.394, '0.006'], //5格為21.995<22
        [RB, STB, 100000, 1, 0.001, 100, '0.001'], //受最小數量與步長限制
        [RB, STB, 55000, 1, 0.001, 55, '0.001'], //邊界(以浮點直接計算會多取一格)
        [RB, STB, 54999, 2, 0.002, 109.998, '0.002'], //1格為54.999<55
        [RB, STB, 16000, 4, 0.004, 64, '0.004'],
        [RC, STC, 10, 10, 1, 10, '1.0'], //名義只需6格, 受最小數量限制取10格
    ]

    //frac, 測試端獨立之精確分數(由String(v)之十進位表示轉{n,d}, d為10的次方)
    let frac = (v) => {
        let [mant, ex] = String(v).trim().replace(/^\+/, '').split('e')
        let [ip, fp = ''] = mant.split('.')
        let n = BigInt((ip || '0') + fp)
        let d = 10n ** BigInt(fp.length)
        let e = ex === undefined ? 0 : Number(ex)
        if (e > 0) {
            n = n * 10n ** BigInt(e)
        }
        else if (e < 0) {
            d = d * 10n ** BigInt(-e)
        }
        return { n, d }
    }
    let fmul = (a, b) => ({ n: a.n * b.n, d: a.d * b.d })
    let fadd1 = (a) => ({ n: a.n + a.d, d: a.d })
    let fint = (k) => ({ n: BigInt(k), d: 1n })
    let fge = (a, b) => a.n * b.d >= b.n * a.d
    let ceilDiv = (a, b) => (a + b - 1n) / b
    //fdec, 分母為10的次方之分數轉定點字串(小數位數 = 分母之位數 - 1)
    let fdec = (a) => {
        let s = a.d.toString().length - 1
        let str = a.n.toString().padStart(s + 1, '0')
        return s === 0 ? str : `${str.slice(0, str.length - s)}.${str.slice(str.length - s)}`
    }

    //refOf, 獨立之整數算式: 回 { k, q0, n0, quantity, notional, quantityStr }
    let refOf = (p, rule, buffer, units) => {
        let step = frac(rule.stepSize)
        let mq = frac(rule.minQty)
        let th = fmul(frac(rule.minNotional), fadd1(frac(buffer)))
        let pp = frac(p)
        let k1 = ceilDiv(mq.n * step.d, mq.d * step.n)
        let k2 = ceilDiv(th.n * pp.d * step.d, th.d * pp.n * step.n)
        let k = k1 > k2 ? k1 : k2
        let q0 = fmul(fint(k), step)
        let n0 = fmul(q0, pp)
        let qu = fmul(fint(units), q0)
        return { k: Number(k), q0: Number(fdec(q0)), n0: Number(fdec(n0)), quantity: Number(fdec(qu)), notional: Number(fdec(fmul(fint(units), n0))), quantityStr: fdec(qu) }
    }
    //assertRef, 結果與獨立算式逐欄相同, 且k-1必違反其一(最小)
    let assertRef = (r, p, rule, buffer, units, tag) => {
        let e = refOf(p, rule, buffer, units)
        assert.deepStrictEqual({ k: r.k, q0: r.q0, n0: r.n0, quantity: r.quantity, notional: r.notional, quantityStr: r.quantityStr, units: r.units }, { ...e, units }, tag)
        let step = frac(rule.stepSize)
        let q1 = fmul(fint(e.k - 1), step)
        let th = fmul(frac(rule.minNotional), fadd1(frac(buffer)))
        assert.ok(!fge(q1, frac(rule.minQty)) || !fge(fmul(q1, frac(p)), th), `${tag} k-1仍合法`)
    }

    //mulberry32, 固定種子之亂數(結果可重現)
    let mulberry32 = (a) => {
        return () => {
            a |= 0
            a = a + 0x6D2B79F5 | 0
            let t = Math.imul(a ^ a >>> 15, 1 | a)
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
            return ((t ^ t >>> 14) >>> 0) / 4294967296
        }
    }

    //badNums, 非有效數字之輸入矩陣(與回測套件之負向矩陣同類)
    let badNums = () => [
        NaN, Infinity, -Infinity, '', ' ', '-', 'N/A', 'Infinity', 'NaN', '0x10', '1,234', '1e400',
        null, undefined, true, false, 10n, Object(2000), Object('2000'), [2000], {}, () => 2000,
    ]
    let show = (v) => (typeof v === 'bigint' ? `${v}n` : String(v))
    let msgOf = (fn) => {
        try {
            fn()
        }
        catch (err) {
            return err.message
        }
        return null
    }

    it('對照表十列: k、q0、n0、數量字串逐列相符(交易規則直接給、由設定物件轉成、由商品資訊轉成三種來源)', async () => {
        for (let [rule, st, p, k, q0, n0, qs] of ROWS) {
            let symb = { filters: [{ filterType: 'MARKET_LOT_SIZE', stepSize: String(rule.stepSize), minQty: String(rule.minQty), maxQty: '10000' }, { filterType: 'MIN_NOTIONAL', notional: String(rule.minNotional) }] }
            for (let [src, rr] of [['rule', rule], ['st', getContractRule(st)], ['symb', getContractRuleFromSymbol(symb)]]) {
                let r = await calcContractUnitsQuantity(p, rr)
                assert.strictEqual(r.k, k, `${src} price ${p} k`)
                assert.strictEqual(r.q0, q0, `${src} price ${p} q0`)
                assert.strictEqual(r.n0, n0, `${src} price ${p} n0`)
                assert.strictEqual(r.quantityStr, qs, `${src} price ${p} quantityStr`)
                assert.strictEqual(r.units, 1)
            }
        }
        //單位數為整數倍: 數量與名義為units倍, k為每單位之格數
        let r3 = await calcContractUnitsQuantity(2001, RA, { units: 3 })
        assert.deepStrictEqual([r3.k, r3.quantityStr, r3.notional], [11, '0.033', 66.033])
        //現行依金額定量之例(標記價2100、22u: 向下取整得0.010, 名義21.0)於以單位數定量為0.011(名義23.1)
        assert.strictEqual(calcContractQuantity('22.00', 2100, 3, { quantityLow: 0.001, notional: 20 }), '0.010')
        assert.deepStrictEqual([(await calcContractUnitsQuantity(2100, RA)).quantityStr, (await calcContractUnitsQuantity(2100, RA)).notional], ['0.011', 23.1])
    })

    it('獨立之整數算式: 對照表 × 緩衝與單位數、各k之邊界價與其下一個浮點數、隨機2000組, 逐欄相同且為最小', async () => {
        //對照表 × opt
        for (let [rule, , p] of ROWS) {
            for (let [buffer, units] of [[0.1, 1], [0.1, 7], [0, 1], [0.25, 3]]) {
                assertRef(await calcContractUnitsQuantity(p, rule, { buffer, units }), p, rule, buffer, units, `row p=${p} buffer=${buffer} units=${units}`)
            }
        }
        //邊界價: p = 門檻/(k×stepSize)恰取k格, 下一個浮點數取k+1格
        let f64 = new Float64Array(1)
        let u64 = new BigUint64Array(f64.buffer)
        let nextDown = (x) => {
            f64[0] = x
            u64[0] -= 1n
            return f64[0]
        }
        assert.strictEqual(Math.ceil(50 * 1.1 / (55000 * 0.001)), 2, '鑑別前提: 浮點直接計算於此邊界多取一格')
        let nEdge = 0
        for (let [rule, th] of [[RA, 22], [RB, 55], [RC, 5.5]]) {
            for (let k = 1; k <= 60; k++) {
                let p = Number((th / (k * rule.stepSize)).toPrecision(12))
                if (!fge(fmul(fmul(fint(k), frac(rule.stepSize)), frac(p)), fmul(frac(rule.minNotional), fadd1(frac(0.1))))) {
                    continue
                }
                for (let pp of [p, nextDown(p)]) {
                    assertRef(await calcContractUnitsQuantity(pp, rule), pp, rule, 0.1, 1, `edge rule=${JSON.stringify(rule)} p=${pp}`)
                    nEdge++
                }
            }
        }
        assert.ok(nEdge >= 60, `邊界數=${nEdge}`)
        //隨機: 規則、價格、緩衝、單位數
        let rng = mulberry32(48117)
        let ri = (a, b) => a + Math.floor(rng() * (b - a + 1))
        let pick = (arr) => arr[Math.floor(rng() * arr.length)]
        let nK1 = 0
        let nK2 = 0
        let nr = 0
        while (nr < 2000) {
            let dS = ri(0, 8)
            let rule = { stepSize: Number(`${pick([1, 2, 5, 25])}e-${dS}`), minQty: Number(`${ri(1, 60)}e-${ri(Math.max(0, dS - 2), dS + 1)}`), minNotional: pick([1, 5, 7.5, 10, 20, 50, 100]) }
            let buffer = pick([0, 0.05, 0.1, 0.15, 0.25, 1])
            let units = pick([1, 1, 2, 3, 30])
            let p = rng() < 0.5 ? Number(`${ri(1, 9999999)}e-${ri(0, 6)}`) : rng() * 10 ** ri(-3, 6)
            if (!(p > 0) || rule.minNotional * 2.1 / (p * rule.stepSize) > 1e14 || rule.minQty / rule.stepSize > 1e14) {
                continue
            }
            let r = await calcContractUnitsQuantity(p, rule, { buffer, units })
            assertRef(r, p, rule, buffer, units, `#${nr} p=${p} rule=${JSON.stringify(rule)}`)
            if (r.k === refOf(1e300, rule, 0, 1).k) {
                nK1++
            }
            else {
                nK2++
            }
            nr++
        }
        //鑑別前提: 最小數量主導與名義門檻主導皆足
        assert.ok(nK1 >= 100 && nK2 >= 100, `最小數量主導${nK1}組、名義門檻主導${nK2}組`)
    })

    it('預設緩衝由本套件明定(BUFFER_DEFAULT = 0.1, 上限BUFFER_MAX = 1): 未給、null、{}皆以之計; 文件之數值與程式同源', async () => {
        assert.strictEqual(BUFFER_DEFAULT, 0.1)
        assert.strictEqual(BUFFER_MAX, 1)
        for (let opt of [undefined, null, {}, { buffer: undefined }, { buffer: null }, Object.assign(Object.create(null), { units: 1 })]) {
            assertRef(await calcContractUnitsQuantity(2000, RA, opt), 2000, RA, BUFFER_DEFAULT, 1, `opt ${JSON.stringify(opt)}`)
        }
        //鑑別前提: 緩衝0與預設之結果不同
        assert.notStrictEqual((await calcContractUnitsQuantity(2000, RA, { buffer: 0 })).k, (await calcContractUnitsQuantity(2000, RA)).k)
        //送單前之檢測: 緩衝未給(undefined、null)取BUFFER_DEFAULT
        let build = await loadBuildBaseUnitNotional()
        assert.strictEqual(checkContractRuleBuffer(build, RA, undefined, 1).buffer, BUFFER_DEFAULT)
        assert.strictEqual(checkContractRuleBuffer(build, RA, null, 1).buffer, BUFFER_DEFAULT)
        //文件之數值: README、對外操作之JSDoc、規則帳本皆以同一值記之
        let readme = fs.readFileSync(path.join(fdRoot, 'README.md'), 'utf8')
        let jsdoc = fs.readFileSync(path.join(fdRoot, 'src', 'opBinaContractMarketUnits.mjs'), 'utf8')
        let rulebook = fs.readFileSync(path.join(fdRoot, 'sgud', 'rule', 'rulebook.md'), 'utf8')
        assert.ok(readme.includes(`\`BUFFER_DEFAULT\`(${BUFFER_DEFAULT})`), 'README')
        assert.ok(readme.includes(`≤ ${BUFFER_MAX}`), 'README之上限')
        assert.ok(jsdoc.includes(`預設BUFFER_DEFAULT即${BUFFER_DEFAULT}`), 'JSDoc')
        assert.ok(rulebook.includes(`\`BUFFER_DEFAULT\`(${BUFFER_DEFAULT})`), '規則帳本')
    })

    it('數量字串: 與套件既有之格式化(calcContractQuantity之向下取整與定點字串)對同一數量相同', async () => {
        //以名義恰為units×q0×價格之金額呼叫calcContractQuantity, 向下取整即得同一格數, 其數量字串須相同
        //價格取至多2位小數、步長至多6位小數, 金額至多8位小數(calcContractQuantity之定點精度)
        let rng = mulberry32(20481)
        let n = 0
        let nDig = new Set()
        while (n < 1500) {
            let d = Math.floor(rng() * 7)
            let st = { digContractQuantity: d, quantityLow: Number(`${1 + Math.floor(rng() * 9)}e-${d}`), notional: [5, 20, 50, 100][Math.floor(rng() * 4)] }
            let rule = getContractRule(st)
            let units = [1, 2, 3, 7, 30][Math.floor(rng() * 5)]
            let p = Math.round(rng() * 10 ** (2 + Math.floor(rng() * 6))) / 100
            if (!(p > 0) || st.notional * 1.2 / (p * rule.stepSize) > 1e12) {
                continue
            }
            let r = await calcContractUnitsQuantity(p, rule, { units })
            let qOld = calcContractQuantity(String(r.notional), p, d, { quantityLow: st.quantityLow, notional: st.notional })
            assert.strictEqual(r.quantityStr, qOld, `#${n} d=${d} p=${p} units=${units}`)
            //小數位數 = digContractQuantity
            assert.strictEqual((r.quantityStr.split('.')[1] || '').length, d)
            nDig.add(d)
            n++
        }
        assert.strictEqual(nDig.size, 7, '小數位數0~6皆有')
    })

    it('getContractRule: stepSize = 10^-digContractQuantity、minQty = quantityLow、minNotional = notional, 數字字串轉為Number', () => {
        assert.deepStrictEqual(getContractRule({ digContractQuantity: 3, quantityLow: 0.002, notional: 20 }), { stepSize: 0.001, minQty: 0.002, minNotional: 20 })
        assert.deepStrictEqual(getContractRule({ digContractQuantity: 0, quantityLow: '1', notional: '5' }), { stepSize: 1, minQty: 1, minNotional: 5 })
        assert.deepStrictEqual(getContractRule({ digContractQuantity: '8', quantityLow: 1e-8, notional: 5 }), { stepSize: 1e-8, minQty: 1e-8, minNotional: 5 })
        assert.deepStrictEqual(getContractRule({ digContractQuantity: 100, quantityLow: 1, notional: 1 }).stepSize, 1e-100)
        //其他欄位不帶
        assert.deepStrictEqual(Object.getOwnPropertyNames(getContractRule({ digContractQuantity: 2, quantityLow: 0.01, notional: 5, uTrade: 22, symbol: 'ETHUSDT' })), ['stepSize', 'minQty', 'minNotional'])
    })

    it('getContractRule 負向: 三欄缺或無效即拋, 訊息指明st之欄位且不回顯值', () => {
        let ok = { digContractQuantity: 3, quantityLow: 0.001, notional: 20 }
        for (let v of [-1, 1.5, 101, '3.5', 'ECHO-9Q', ...badNums()]) {
            assert.throws(() => getContractRule({ ...ok, digContractQuantity: v }), { message: 'invalid st.digContractQuantity: must be an integer from 0 to 100' }, `dig ${show(v)}`)
        }
        for (let [k, msg] of [['quantityLow', 'invalid st.quantityLow: must be a positive number'], ['notional', 'invalid st.notional: must be a positive number']]) {
            let st = { ...ok }
            delete st[k]
            assert.throws(() => getContractRule(st), { message: msg }, `缺${k}`)
            for (let v of [0, -0.001, '0', 'ECHO-9Q', ...badNums()]) {
                assert.throws(() => getContractRule({ ...ok, [k]: v }), { message: msg }, `${k} ${show(v)}`)
            }
        }
        for (let st of [undefined, null, 'st', 1]) {
            assert.throws(() => getContractRule(st), { message: 'invalid st.digContractQuantity: must be an integer from 0 to 100' })
        }
    })

    it('getContractRuleFromSymbol: 步長與最小數量取MARKET_LOT_SIZE(不取LOT_SIZE)、最小名義價值取MIN_NOTIONAL之notional; 帶標的名與單筆數量上限', async () => {
        //交易所之實際回應(欄位為字串、filters次序不定)
        let symbEth = {
            symbol: 'ETHUSDT',
            quantityPrecision: 3,
            filters: [
                { filterType: 'PRICE_FILTER', minPrice: '39.86', maxPrice: '306177', tickSize: '0.01' },
                { stepSize: '0.001', maxQty: '10000', filterType: 'LOT_SIZE', minQty: '0.001' },
                { filterType: 'MARKET_LOT_SIZE', stepSize: '0.001', minQty: '0.001', maxQty: '8000' },
                { limit: 200, filterType: 'MAX_NUM_ORDERS' },
                { filterType: 'MIN_NOTIONAL', notional: '20' },
            ],
        }
        //maxQty取MARKET_LOT_SIZE之8000(不取LOT_SIZE之10000)
        assert.deepStrictEqual(getContractRuleFromSymbol(symbEth), { stepSize: 0.001, minQty: 0.001, minNotional: 20, maxQty: 8000, symbol: 'ETHUSDT' })
        //鑑別前提: LOT_SIZE與MARKET_LOT_SIZE不同時, 取後者(市價單之數量規則), 兩者所得之數量不同; 無symbol、無maxQty者不帶
        let symb = {
            filters: [
                { filterType: 'MIN_NOTIONAL', notional: '5.00000000' },
                { filterType: 'LOT_SIZE', stepSize: '0.01000000', minQty: '0.05000000' },
                { filterType: 'MARKET_LOT_SIZE', stepSize: '0.00100000', minQty: '0.00200000' },
            ],
        }
        let rule = getContractRuleFromSymbol(symb)
        assert.deepStrictEqual(rule, { stepSize: 0.001, minQty: 0.002, minNotional: 5 })
        let rM = await calcContractUnitsQuantity(100, rule)
        let rL = await calcContractUnitsQuantity(100, { stepSize: 0.01, minQty: 0.05, minNotional: 5 })
        assert.strictEqual(rM.quantityStr, '0.055')
        assert.notStrictEqual(rM.quantityStr, rL.quantityStr)
        //symbol非字串或空字串者不帶
        assert.deepStrictEqual(Object.getOwnPropertyNames(getContractRuleFromSymbol({ ...symb, symbol: '' })), ['stepSize', 'minQty', 'minNotional'])
    })

    it('getContractRuleFromSymbol 負向: 缺filter或欄位無效即拋(缺MARKET_LOT_SIZE不改取LOT_SIZE), 訊息指明filter之欄位且不回顯值', () => {
        let fl = { filterType: 'MARKET_LOT_SIZE', stepSize: '0.001', minQty: '0.001' }
        let fn = { filterType: 'MIN_NOTIONAL', notional: '20' }
        for (let symb of [undefined, null, {}, { filters: [] }, { filters: 'x' }, { filters: {} }]) {
            assert.throws(() => getContractRuleFromSymbol(symb), { message: 'invalid symb.filters: must be a non-empty array' })
        }
        //缺MARKET_LOT_SIZE(只有LOT_SIZE)不改取LOT_SIZE
        assert.throws(() => getContractRuleFromSymbol({ filters: [{ ...fl, filterType: 'LOT_SIZE' }, fn] }), { message: 'invalid symb.filters.MARKET_LOT_SIZE.stepSize: must be a positive number' })
        assert.throws(() => getContractRuleFromSymbol({ filters: [fl] }), { message: 'invalid symb.filters.MIN_NOTIONAL.notional: must be a positive number' })
        for (let v of [0, '-1', 'ECHO-9Q', ...badNums().filter((x) => x !== null && x !== undefined)]) {
            assert.throws(() => getContractRuleFromSymbol({ filters: [{ ...fl, maxQty: v }, fn] }), { message: 'invalid symb.filters.MARKET_LOT_SIZE.maxQty: must be a positive number' }, `maxQty ${show(v)}`)
        }
        for (let v of [0, '-1', 'ECHO-9Q', ...badNums()]) {
            assert.throws(() => getContractRuleFromSymbol({ filters: [{ ...fl, stepSize: v }, fn] }), { message: 'invalid symb.filters.MARKET_LOT_SIZE.stepSize: must be a positive number' }, `stepSize ${show(v)}`)
            assert.throws(() => getContractRuleFromSymbol({ filters: [{ ...fl, minQty: v }, fn] }), { message: 'invalid symb.filters.MARKET_LOT_SIZE.minQty: must be a positive number' }, `minQty ${show(v)}`)
            assert.throws(() => getContractRuleFromSymbol({ filters: [fl, { ...fn, notional: v }] }), { message: 'invalid symb.filters.MIN_NOTIONAL.notional: must be a positive number' }, `notional ${show(v)}`)
        }
    })

    it('交易規則與緩衝之有效性與可計算性 = buildBaseUnitNotional之判定與訊息(名稱opt); 緩衝另限 ≤ 1(較嚴); 通過者轉為Number', async () => {
        class Holder {}
        let build = await loadBuildBaseUnitNotional()
        assert.strictEqual(build, buildBaseUnitNotional, '載入之函數即已安裝之回測套件之buildBaseUnitNotional')
        //交易規則: 本套件之結果(訊息或通過) = buildBaseUnitNotional({ rule, buffer: 0.1, units: 1 }, 'opt')
        let rules = [RA, { ...RA, asOf: 'x' }, Object.assign(Object.create(null), RA), { stepSize: '0.001', minQty: ' 0.001 ', minNotional: '2e1' },
            undefined, 'rule', 1, [], new Date(0), new Map(), Object.assign(new Holder(), RA), {},
            getContractRule({ digContractQuantity: 20, quantityLow: 0.001, notional: 20 }), { stepSize: 1e-30, minQty: 1, minNotional: 5 }]
        for (let k of ['stepSize', 'minQty', 'minNotional']) {
            for (let v of [0, -0.001, '0', ...badNums()]) {
                rules.push({ ...RA, [k]: v })
            }
        }
        let nRuleBad = 0
        for (let [i, rule] of rules.entries()) {
            let a = msgOf(() => checkContractRuleBuffer(build, rule, undefined, 1, 'opt'))
            let b = msgOf(() => buildBaseUnitNotional({ rule, buffer: 0.1, units: 1 }, 'opt'))
            assert.strictEqual(a, b, `rule #${i}`)
            nRuleBad += a === null ? 0 : 1
        }
        assert.ok(nRuleBad >= 50 && nRuleBad < rules.length, '鑑別前提: 有效與無效皆有')
        //單位數亦交判定(數量超出雙精度範圍與單位數有關): 步長1e300、單位數為安全整數之上限 ⇒ 訊息同buildBaseUnitNotional; 同規則之1單位照過(鑑別前提)
        let RH = { stepSize: 1e300, minQty: 1e300, minNotional: 5 }
        assert.strictEqual(msgOf(() => checkContractRuleBuffer(build, RH, undefined, 9007199254740991, 'opt')), msgOf(() => buildBaseUnitNotional({ rule: RH, buffer: 0.1, units: 9007199254740991 }, 'opt')))
        assert.strictEqual(msgOf(() => checkContractRuleBuffer(build, RH, undefined, 9007199254740991, 'opt')), 'invalid opt: quantity and notional must be finite numbers')
        assert.strictEqual(msgOf(() => checkContractRuleBuffer(build, RH, undefined, 1, 'opt')), null)
        //訊息之名稱為本套件之參數名
        assert.strictEqual(msgOf(() => checkContractRuleBuffer(build, 'ECHO-9Q', undefined, 1, 'opt')), 'invalid opt.rule: must be an object')
        assert.strictEqual(msgOf(() => checkContractRuleBuffer(build, { ...RA, minQty: 'ECHO-9Q' }, undefined, 1, 'opt')), 'invalid opt.rule.minQty: must be a positive number')
        assert.strictEqual(msgOf(() => checkContractRuleBuffer(build, getContractRule({ digContractQuantity: 20, quantityLow: 0.001, notional: 20 }), undefined, 1, 'opt')), 'invalid opt: step count k must not exceed Number.MAX_SAFE_INTEGER')
        //緩衝: 回測套件拒者訊息同之; 回測套件收而 > 1 者本套件拒(較嚴)
        let nStricter = 0
        for (let v of [0, '0', 0.1, '0.25', ' 0.25 ', 1, '1', 1.0000001, 3, 10, '10', -0.1, -1e-12, '-0.1', ...badNums().filter((x) => x !== null && x !== undefined)]) {
            let b = msgOf(() => buildBaseUnitNotional({ rule: RA, buffer: v, units: 1 }, 'opt'))
            let a = msgOf(() => checkContractRuleBuffer(build, RA, v, 1, 'opt'))
            if (b !== null) {
                assert.strictEqual(a, b, `buffer ${show(v)}: 訊息同回測套件`)
            }
            else if (Number(v) > BUFFER_MAX) {
                assert.strictEqual(a, 'invalid opt.buffer: must be a number from 0 to 1', `buffer ${show(v)}: 較嚴`)
                nStricter++
            }
            else {
                assert.strictEqual(a, null, `buffer ${show(v)}`)
            }
        }
        assert.ok(nStricter >= 4, '鑑別前提: 回測套件收而本套件拒者')
        //轉換後之值(數字字串轉為Number, 其他欄位不帶)
        assert.deepStrictEqual(checkContractRuleBuffer(build, { stepSize: '0.001', minQty: ' 0.001 ', minNotional: '2e1', asOf: 'x' }, ' 0.25 ', 1, 'opt'), { rule: RA, buffer: 0.25 })
    })

    it('交易規則之選填欄位: maxQty為有效數字 > 0、symbol為非空字串, 給了即檢、未給不帶', async () => {
        let build = await loadBuildBaseUnitNotional()
        assert.deepStrictEqual(checkContractRuleBuffer(build, { ...RA, maxQty: '100', symbol: 'ETHUSDT' }, 0.1, 1).rule, { ...RA, maxQty: 100, symbol: 'ETHUSDT' })
        assert.deepStrictEqual(checkContractRuleBuffer(build, { ...RA, maxQty: null, symbol: null }, 0.1, 1).rule, RA)
        for (let v of [0, -1, '0', 'ECHO-9Q', NaN, Infinity, true, {}, []]) {
            assert.throws(() => checkContractRuleBuffer(build, { ...RA, maxQty: v }, 0.1, 1, 'opt'), { message: 'invalid opt.rule.maxQty: must be a positive number' }, `maxQty ${show(v)}`)
        }
        for (let v of ['', 1, true, {}, [], 10n]) {
            assert.throws(() => checkContractRuleBuffer(build, { ...RA, symbol: v }, 0.1, 1, 'opt'), { message: 'invalid opt.rule.symbol: must be a non-empty string' }, `symbol ${show(v)}`)
        }
    })

    it('單位數、每單名目之上限(必給)、單位數之上限(選填): 收數字與數字字串, 通過即轉為Number; 無效即拋', () => {
        //單位數: 有效整數(含整數值之數字字串)且 ≥ 1、安全整數內; 本套件收者回測套件必收(同種類)
        let unitsVals = [
            [1, 1], [2, 2], [30, 30], [9007199254740991, 9007199254740991], ['3', 3], [' 7 ', 7], ['2.0', 2], ['22.00', 22], ['1e1', 10], ['+3', 3],
            [0, null], [-1, null], [1.5, null], ['1.5', null], ['0', null], [2 ** 53, null], ['9007199254740993', null], ['1e21', null], ['ECHO-9Q', null],
            ...badNums().map((v) => [v, null]),
        ]
        for (let [v, e] of unitsVals) {
            let m = msgOf(() => checkContractUnits(v))
            if (e === null) {
                assert.strictEqual(m, 'invalid units: must be a positive integer', `units ${show(v)}`)
            }
            else {
                assert.strictEqual(m, null, `units ${show(v)}`)
                assert.strictEqual(checkContractUnits(v), e, `units ${show(v)}: 轉換值`)
                assert.strictEqual(msgOf(() => calcBaseUnitQuantity(3000, RA, { units: v })), null, `units ${show(v)}: 回測套件亦收`)
            }
        }
        //每單名目之上限
        for (let [v, e] of [[30, 30], ['30', 30], [' 30 ', 30], [0.5, 0.5], ['2.5e1', 25], [1e21, 1e21]]) {
            assert.strictEqual(checkContractMaxNotional(v), e, `maxNotional ${show(v)}`)
        }
        for (let v of [0, -1, '0', '-5', 'ECHO-9Q', ...badNums()]) {
            assert.throws(() => checkContractMaxNotional(v), { message: 'invalid opt.maxNotional: must be a positive number' }, `maxNotional ${show(v)}`)
        }
        //單位數之上限
        assert.strictEqual(checkContractMaxUnits(undefined), null)
        assert.strictEqual(checkContractMaxUnits(null), null)
        for (let [v, e] of [[4, 4], ['4', 4], [' 4 ', 4], ['4.0', 4]]) {
            assert.strictEqual(checkContractMaxUnits(v), e, `maxUnits ${show(v)}`)
        }
        for (let v of [0, -1, 1.5, '1.5', 'ECHO-9Q', 2 ** 53, ...badNums().filter((x) => x !== null && x !== undefined)]) {
            assert.throws(() => checkContractMaxUnits(v), { message: 'invalid opt.maxUnits: must be a positive integer' }, `maxUnits ${show(v)}`)
        }
    })

    it('上限之下界(與價格無關): units × minNotional × (1 + buffer) > maxNotional、units × 最小合法數量 > maxQty 即拋; 十進位精確比較, 恰等於者不拒', () => {
        let MSG_N = 'invalid units or opt.maxNotional: notional must not exceed opt.maxNotional at any price'
        let MSG_Q = 'invalid units or opt.rule.maxQty: quantity must not exceed opt.rule.maxQty at any price'
        //恰等於: 浮點計算會誤拒之組合(鑑別前提)
        let eq = [[RA, 0.1, 1, 22], [RB, 0.1, 1, 55], [RB, 0.1, 2, 110], [{ ...RA, minNotional: 100 }, 0.1, 2, 220], [{ ...RA, minNotional: 7.5 }, 0.1, 3, 24.75], [RA, 0.1, 3, 66], [RC, 0.1, 7, 38.5], [RA, 0.15, 3, 69], [RA, 0, 5, 100], [RA, 1, 2, 80]]
        let nFloatWrong = 0
        for (let [rule, buffer, units, maxNotional] of eq) {
            assert.doesNotThrow(() => checkContractBounds(calcBaseUnitQuantity, rule, buffer, units, maxNotional), `${JSON.stringify(rule)} ${buffer} ${units} ${maxNotional}`)
            nFloatWrong += units * rule.minNotional * (1 + buffer) > maxNotional ? 1 : 0
        }
        assert.ok(nFloatWrong >= 3, `鑑別前提: 浮點計算誤拒之組合數 ${nFloatWrong}`)
        //超過(最小之十進位差)
        for (let [rule, buffer, units, maxNotional] of [[RA, 0.1, 1, 21.999999], [RB, 0.1, 1, 54.99], [RA, 0.1, 22, 30], [RA, 0, 5, 99.99]]) {
            assert.throws(() => checkContractBounds(calcBaseUnitQuantity, rule, buffer, units, maxNotional), { message: MSG_N })
        }
        //maxQty: 恰等於不拒(浮點之3 × 0.1 > 0.3)、超過即拒; 未帶maxQty不檢
        let RQ = { stepSize: 0.1, minQty: 0.1, minNotional: 5 }
        assert.ok(3 * 0.1 > 0.3)
        assert.doesNotThrow(() => checkContractBounds(calcBaseUnitQuantity, { ...RQ, maxQty: 0.3 }, 0.1, 3, 1e9))
        assert.throws(() => checkContractBounds(calcBaseUnitQuantity, { ...RQ, maxQty: 0.29 }, 0.1, 3, 1e9), { message: MSG_Q })
        //最小合法數量受最小數量所限(步長0.001、最小數量0.005 ⇒ 0.005)
        assert.doesNotThrow(() => checkContractBounds(calcBaseUnitQuantity, { stepSize: 0.001, minQty: 0.005, minNotional: 5, maxQty: 0.01 }, 0.1, 2, 1e9))
        assert.throws(() => checkContractBounds(calcBaseUnitQuantity, { stepSize: 0.001, minQty: 0.005, minNotional: 5, maxQty: 0.009 }, 0.1, 2, 1e9), { message: MSG_Q })
        assert.doesNotThrow(() => checkContractBounds(calcBaseUnitQuantity, RQ, 0.1, 1e6, 1e12))
        //最小合法數量之試算失敗(極端之規則: 名義門檻不起作用之價格下名義超出雙精度範圍)⇒ 不可計算而拒(fail-closed), 不視為數量0而放行
        let RX = { stepSize: 2e284, minQty: 2e299, minNotional: 1e300, maxQty: 10 }
        assert.strictEqual(msgOf(() => buildBaseUnitNotional({ rule: RX, buffer: 0, units: 1 }, 'opt')), null, '前提: 規則與緩衝之判定(buildBaseUnitNotional)照過')
        assert.throws(() => checkContractBounds(calcBaseUnitQuantity, RX, 0, 1, 1e301), { message: 'invalid opt.rule: minimum quantity must be computable' })
        //隨機: 與獨立之整數算式之判定逐組相同(接受 ⇔ units×門檻 ≤ maxNotional 且 units×⌈minQty÷stepSize⌉×stepSize ≤ maxQty)
        let rng = mulberry32(99)
        let ri = (a, b) => a + Math.floor(rng() * (b - a + 1))
        let pick = (arr) => arr[Math.floor(rng() * arr.length)]
        let nAcc = 0
        let nRej = 0
        for (let i = 0; i < 1500; i++) {
            let dS = ri(0, 6)
            let rule = { stepSize: Number(`${pick([1, 2, 5])}e-${dS}`), minQty: Number(`${ri(1, 30)}e-${dS}`), minNotional: pick([1, 5, 7.5, 10, 20, 50]) }
            let buffer = pick([0, 0.05, 0.1, 0.15, 0.25, 1])
            let units = pick([1, 2, 3, 7, 30])
            let th = fmul(frac(rule.minNotional), fadd1(frac(buffer)))
            let lb = fmul(fint(units), th)
            //上限取下界本身、其上下之十進位鄰值
            let lbStr = fdec({ n: lb.n * (10n ** 6n) / lb.d, d: 10n ** 6n })
            let maxNotional = Number(pick([lbStr, (Number(lbStr) + 0.000001).toFixed(6), (Number(lbStr) - 0.000001).toFixed(6)]))
            let step = frac(rule.stepSize)
            let mq = frac(rule.minQty)
            let k1 = ceilDiv(mq.n * step.d, mq.d * step.n)
            let qMin = fmul(fint(units), fmul({ n: k1, d: 1n }, step))
            let useQ = rng() < 0.5
            let maxQty = Number(pick([fdec(qMin), (Number(fdec(qMin)) * 1.5).toPrecision(6), (Number(fdec(qMin)) * 0.9).toPrecision(6)]))
            let r = useQ ? { ...rule, maxQty } : rule
            let okN = !fge(lb, fmul(frac(maxNotional), { n: 1n, d: 1n })) || (lb.n * frac(maxNotional).d === frac(maxNotional).n * lb.d)
            let okQ = !useQ || !fge(qMin, frac(maxQty)) || (qMin.n * frac(maxQty).d === frac(maxQty).n * qMin.d)
            let a = msgOf(() => checkContractBounds(calcBaseUnitQuantity, r, buffer, units, maxNotional)) === null
            assert.strictEqual(a, okN && okQ, `#${i} rule=${JSON.stringify(r)} buffer=${buffer} units=${units} maxNotional=${maxNotional}`)
            if (a) {
                nAcc++
            }
            else {
                nRej++
            }
        }
        assert.ok(nAcc >= 200 && nRej >= 200, `接受${nAcc}、拒${nRej}`)
    })

    it('負向: 價格非正或非有限、規則缺欄或非正、緩衝為負、單位數非正整數時reject(不回0、不靜默改值), 訊息同calcBaseUnitQuantity且不回顯值', async () => {
        let cases = [
            [0, RA, {}], [-1, RA, {}], [NaN, RA, {}], [Infinity, RA, {}], ['ECHO-9Q', RA, {}], [null, RA, {}],
            [3000, null, {}], [3000, {}, {}], [3000, { ...RA, stepSize: 0 }, {}], [3000, { ...RA, minQty: -1 }, {}], [3000, { stepSize: 0.001, minQty: 0.001 }, {}],
            [3000, RA, { buffer: -0.1 }], [3000, RA, { buffer: 'ECHO-9Q' }],
            [3000, RA, { units: 0 }], [3000, RA, { units: 1.5 }], [3000, RA, { units: -2 }], [3000, RA, { units: 'ECHO-9Q' }],
        ]
        for (let [p, rule, opt] of cases) {
            let expected = msgOf(() => calcBaseUnitQuantity(p, rule, opt))
            assert.ok(expected !== null && /^invalid /.test(expected), `前提: calcBaseUnitQuantity拒絕 ${show(p)}`)
            await assert.rejects(calcContractUnitsQuantity(p, rule, opt), (err) => err.message === expected && !/ECHO-9Q/.test(err.message), `p=${show(p)} rule=${JSON.stringify(rule)} opt=${JSON.stringify(opt)}`)
        }
    })

    it('載入之函數即已安裝之回測套件之檔; 打包設定之external含src所動態載入之兩個路徑(打包檔亦於執行期取用已安裝之檔)', async () => {
        assert.strictEqual(await loadCalcBaseUnitQuantity(), calcBaseUnitQuantity)
        assert.strictEqual(await loadBuildBaseUnitNotional(), buildBaseUnitNotional)
        //src內對回測套件之引用: 只在calcContractUnitsQuantity.mjs, 皆為動態載入之字面路徑(頂層不匯入)
        let fdSrc = path.join(fdRoot, 'src')
        let specs = []
        for (let fn of fs.readdirSync(fdSrc).filter((f) => f.endsWith('.mjs'))) {
            let code = fs.readFileSync(path.join(fdSrc, fn), 'utf8')
            for (let m of code.matchAll(/(import\s*\(\s*|from\s+)'(w-trade-backtest[^']*)'/g)) {
                specs.push([fn, m[1].startsWith('import') ? 'dynamic' : 'static', m[2]])
            }
        }
        assert.deepStrictEqual(specs, [
            ['calcContractUnitsQuantity.mjs', 'dynamic', 'w-trade-backtest/src/calcBaseUnitQuantity.mjs'],
            ['calcContractUnitsQuantity.mjs', 'dynamic', 'w-trade-backtest/src/buildBaseUnitNotional.mjs'],
        ])
        //打包設定(toolg/gDistRollup.mjs)之external須逐字含此兩個路徑, 否則打包工具內聯為快照
        let cfg = fs.readFileSync(path.join(fdRoot, 'toolg', 'gDistRollup.mjs'), 'utf8')
        let ext = /external:\s*\[([\s\S]*?)\]/.exec(cfg)
        assert.ok(ext, '前提: 找得到external設定')
        let listed = [...ext[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
        for (let [, , spec] of specs) {
            assert.ok(listed.includes(spec), `external須列${spec}`)
        }
    })

})
