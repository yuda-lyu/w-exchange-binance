//模組解析鉤子(測試用, 經module.register載入): 取用w-trade-backtest/src/calcBaseUnitQuantity.mjs或w-trade-backtest/src/buildBaseUnitNotional.mjs時
//  register之data.mode為'missing'(預設): calcBaseUnitQuantity.mjs解析失敗, 模擬相依之w-trade-backtest為不含該檔之版本或未安裝
//  register之data.mode為'missingBuild': buildBaseUnitNotional.mjs解析失敗(calcBaseUnitQuantity.mjs照常)
//  register之data.mode為'nodefault': calcBaseUnitQuantity.mjs改解析為無預設匯出之模組, 模擬該檔存在而預設匯出不是函數
//  register之data.mode為'spy': 兩檔皆改解析為包裝真檔之模組, 每次呼叫之選項之複本記於globalThis.__baseUnitSpy({f,opt}), 結果照真檔
//  以裸路徑(非相對路徑)取用者才經本鉤子; 回測套件內部之相對匯入不受影響
let mode = 'missing'
let RE_CALC = /^w-trade-backtest\/src\/calcBaseUnitQuantity\.mjs$/
let RE_BUILD = /^w-trade-backtest\/src\/buildBaseUnitNotional\.mjs$/
let missing = (specifier) => {
    let err = new Error(`Cannot find module '${specifier}' (simulated by test hook)`)
    err.code = 'ERR_MODULE_NOT_FOUND'
    return err
}
let spyCode = (f, realUrl, nArg) => {
    let rec = `(globalThis.__baseUnitSpy = globalThis.__baseUnitSpy || []).push({ f: ${JSON.stringify(f)}, opt: o === undefined ? 'undefined' : JSON.parse(JSON.stringify(o, (k, v) => (v === undefined ? '__undefined__' : v))) })`
    let sig = nArg === 3 ? '(p, r, o)' : '(o, n)'
    let call = nArg === 3 ? 'real(p, r, o)' : 'real(o, n)'
    return `import real from ${JSON.stringify(realUrl)}\nexport default ${sig} => { ${rec}; return ${call} }\n`
}
export async function initialize(data) {
    mode = (data && data.mode) || 'missing'
}
export async function resolve(specifier, context, nextResolve) {
    if (RE_CALC.test(specifier)) {
        if (mode === 'missing') {
            throw missing(specifier)
        }
        if (mode === 'nodefault') {
            return { url: 'data:text/javascript,export const notDefault = 1', shortCircuit: true }
        }
        if (mode === 'spy') {
            let real = await nextResolve(specifier, context)
            return { url: `data:text/javascript,${encodeURIComponent(spyCode('calc', real.url, 3))}`, shortCircuit: true }
        }
    }
    if (RE_BUILD.test(specifier)) {
        if (mode === 'missingBuild') {
            throw missing(specifier)
        }
        if (mode === 'spy') {
            let real = await nextResolve(specifier, context)
            return { url: `data:text/javascript,${encodeURIComponent(spyCode('build', real.url, 2))}`, shortCircuit: true }
        }
    }
    return nextResolve(specifier, context)
}
