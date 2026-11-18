//子行程(測試用): 掛上noBaseUnitHook後載入本套件, 於本機假伺服器上各跑一次依金額定量與依單位數定量, 結果以一行JSON輸出
//  node test/tools/noBaseUnitRun.mjs [missing|missingBuild|nodefault|spy]
//  missing / missingBuild / nodefault: 驗未用新入口者照常、新入口拋明確之錯誤且請求0次; spy: 記下傳給回測套件兩函數之選項(驗預設緩衝由本套件明傳)
//  module.register需Node >= 20.6(或18.19), 由呼叫端之測試先判定
import { register } from 'module'

let mode = process.argv[2] || 'missing'
register('./noBaseUnitHook.mjs', { parentURL: import.meta.url, data: { mode } })

let out = { mode }

//鉤子生效之前提
let probe = async (spec) => {
    try {
        let m = await import(spec)
        return typeof m.default === 'function' ? 'loaded' : 'nodefault'
    }
    catch (err) {
        return 'blocked'
    }
}
out.hookCalc = await probe('w-trade-backtest/src/calcBaseUnitQuantity.mjs')
out.hookBuild = await probe('w-trade-backtest/src/buildBaseUnitNotional.mjs')

let { default: webina } = await import('../../src/WExchangeBinance.mjs')
let { default: ott } = await import('../../src/ott.mjs')
let { default: calcContractQuantity } = await import('../../src/calcContractQuantity.mjs')
let { default: calcContractUnitsQuantity } = await import('../../src/calcContractUnitsQuantity.mjs')
let { blocked, mkFake, startFake, stopFake } = await import('./binaFakeServer.mjs')
out.aggregate = [typeof webina.opBinaContractMarket, typeof webina.opBinaContractMarketUnits]
let RA = { stepSize: 0.001, minQty: 0.001, minNotional: 20 }

await startFake()
try {

    if (mode === 'spy') {
        //未給緩衝: 傳給回測函數之opt.buffer須為本套件之預設0.1(不是undefined); 給了則原樣
        globalThis.__baseUnitSpy = []
        await calcContractUnitsQuantity(2000, RA)
        await calcContractUnitsQuantity(2000, RA, { units: 2 })
        await calcContractUnitsQuantity(2000, RA, { buffer: 0.25 })
        out.spyCalc = globalThis.__baseUnitSpy
        //新入口(規則未帶maxQty): 規則與緩衝之判定1次(build) + 依標記價之定量1次(calc)
        globalThis.__baseUnitSpy = []
        let fx = mkFake()
        let r = await webina.opBinaContractMarketUnits(fx.st, ott, 'long', `tdid-nb-${Date.now()}-0`, 1, 0.04, 0.02, { forceTest: true, maxNotional: 100 })
        out.spyEntry = globalThis.__baseUnitSpy
        out.spyEntryQty = r.quantity
        //新入口(規則帶maxQty): 另加最小合法數量之試算1次(calc)
        globalThis.__baseUnitSpy = []
        let fx2 = mkFake()
        let r2 = await webina.opBinaContractMarketUnits(fx2.st, ott, 'long', `tdid-nb-${Date.now()}-1`, 1, 0.04, 0.02, { forceTest: true, maxNotional: 100, rule: { ...RA, maxQty: 100 } })
        out.spyEntryQ = globalThis.__baseUnitSpy
        out.spyEntryQQty = r2.quantity
    }
    else {
        //依金額定量: 照常
        out.calcContractQuantity = calcContractQuantity('22.00', 2210, 3, { quantityLow: 0.001, notional: 20 })
        let fx = mkFake()
        let r = await webina.opBinaContractMarket(fx.st, ott, 'long', `tdid-nb-${Date.now()}-1`, 22, 0.04, 0.02, { forceTest: true })
        out.market = { quantity: r.quantity, nOrder: fx.count('POST /fapi/v1/order'), nAlgo: fx.count('POST /fapi/v1/algoOrder') }

        //依單位數定量: 於任何請求前拋明確之錯誤
        let fx2 = mkFake()
        try {
            await webina.opBinaContractMarketUnits(fx2.st, ott, 'long', `tdid-nb-${Date.now()}-2`, 1, 0.04, 0.02, { forceTest: true, maxNotional: 100, setLever: true })
            out.units = 'resolved'
        }
        catch (err) {
            out.units = err.message
            out.unitsCause = !!err.cause
        }
        out.unitsReqs = fx2.reqs.length

        try {
            await calcContractUnitsQuantity(2000, RA)
            out.calcUnits = 'resolved'
        }
        catch (err) {
            out.calcUnits = err.message
        }
    }

    out.blocked = blocked.length
}
finally {
    await stopFake()
}

console.log(JSON.stringify(out))
