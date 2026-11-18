import assert from 'assert'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'


//相依之隔離與傳遞(規則見sgud/rule/rulebook.md之R-UNITS-02): w-trade-backtest/src/calcBaseUnitQuantity.mjs與buildBaseUnitNotional.mjs只在以單位數定量時才載入
//子行程以模組解析鉤子擋下或替換其一(模擬相依為不含該檔之版本), 驗: 聚合入口可載入、依金額定量照常成交; 依單位數定量於任何請求前拋明確之錯誤
//另以鉤子包裝兩檔, 驗傳給回測套件之選項(預設緩衝由本套件明傳)
//打包檔(dist)之同一性質於打包時以external達成, 其驗證見sgud/exp/experience.md(打包之驗證); 本檔只驗src路徑
//子行程自起本機假伺服器(固定埠), 本檔不起; 子行程之網路守門同其他測試
describe('相依之隔離與傳遞: 回測套件不含基礎單位之兩檔時、傳給回測套件之選項 (子行程, 本機假伺服器)', function() {
    this.timeout(180000)

    let fdTools = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tools')
    let runChild = (mode) => {
        let env = { ...process.env }
        delete env.BINA_LIVE_TEST
        let r = spawnSync(process.execPath, [path.join(fdTools, 'noBaseUnitRun.mjs'), mode], { env, encoding: 'utf8', windowsHide: true, timeout: 120000 })
        assert.strictEqual(r.status, 0, `子行程失敗: ${r.stderr}`)
        let line = String(r.stdout).trim().split('\n').pop()
        return JSON.parse(line)
    }
    let MSG_CALC = 'calcBaseUnitQuantity unavailable: requires w-trade-backtest with src/calcBaseUnitQuantity.mjs'
    let MSG_BUILD = 'buildBaseUnitNotional unavailable: requires w-trade-backtest with src/buildBaseUnitNotional.mjs'

    before(function() {
        //module.register需Node >= 20.6
        let [major, minor] = process.versions.node.split('.').map(Number)
        if (major < 20 || (major === 20 && minor < 6)) {
            this.skip()
        }
    })

    it('calcBaseUnitQuantity.mjs不存在: 依金額定量照常(聚合入口可載入、成交並掛保護); 依單位數定量拋明確之錯誤且請求0次(含帳戶設定)', () => {
        let o = runChild('missing')
        assert.strictEqual(o.hookCalc, 'blocked', '前提: 鉤子確實擋下該檔')
        assert.deepStrictEqual(o.aggregate, ['function', 'function'])
        assert.strictEqual(o.calcContractQuantity, '0.010')
        //標記價3000.00、22u: 向下取整0.007(名義21 >= 20)
        assert.deepStrictEqual(o.market, { quantity: '0.007', nOrder: 1, nAlgo: 2 })
        assert.strictEqual(o.units, MSG_CALC)
        assert.strictEqual(o.unitsCause, true, '原錯在cause')
        assert.strictEqual(o.unitsReqs, 0)
        assert.strictEqual(o.calcUnits, MSG_CALC)
        assert.strictEqual(o.blocked, 0, '不得有連外嘗試')
    })

    it('buildBaseUnitNotional.mjs不存在: 依金額定量照常; 依單位數定量拋明確之錯誤且請求0次; 只計算之calcContractUnitsQuantity不依賴它', () => {
        let o = runChild('missingBuild')
        assert.deepStrictEqual([o.hookCalc, o.hookBuild], ['loaded', 'blocked'], '前提: 鉤子只擋下build')
        assert.deepStrictEqual(o.market, { quantity: '0.007', nOrder: 1, nAlgo: 2 })
        assert.strictEqual(o.units, MSG_BUILD)
        assert.strictEqual(o.unitsCause, true, '原錯在cause')
        assert.strictEqual(o.unitsReqs, 0)
        assert.strictEqual(o.calcUnits, 'resolved')
        assert.strictEqual(o.blocked, 0, '不得有連外嘗試')
    })

    it('calcBaseUnitQuantity.mjs存在而預設匯出不是函數: 依單位數定量拋同一錯誤且請求0次, 依金額定量照常', () => {
        let o = runChild('nodefault')
        assert.strictEqual(o.hookCalc, 'nodefault', '前提: 鉤子改解析為無預設匯出之模組')
        assert.deepStrictEqual(o.market, { quantity: '0.007', nOrder: 1, nAlgo: 2 })
        assert.strictEqual(o.units, MSG_CALC)
        assert.strictEqual(o.unitsReqs, 0)
        assert.strictEqual(o.calcUnits, MSG_CALC)
    })

    it('預設緩衝由本套件明傳: 未給緩衝時, 傳給回測套件兩函數之buffer為BUFFER_DEFAULT(0.1), 不依賴其預設(含判定、最小合法數量之試算與定量)', () => {
        let o = runChild('spy')
        assert.deepStrictEqual([o.hookCalc, o.hookBuild], ['loaded', 'loaded'], '前提: 鉤子改解析為包裝真檔之模組')
        assert.deepStrictEqual(o.spyCalc.map((x) => [x.f, x.opt.buffer, x.opt.units === undefined ? null : x.opt.units]), [['calc', 0.1, null], ['calc', 0.1, 2], ['calc', 0.25, null]])
        //新入口: 判定1次(build, 名稱opt) + 定量1次(calc), 皆明傳緩衝與單位數
        assert.deepStrictEqual(o.spyEntry.map((x) => [x.f, x.opt.buffer, x.opt.units]), [['build', 0.1, 1], ['calc', 0.1, 1]])
        assert.deepStrictEqual(o.spyEntry[0].opt.rule, { stepSize: 0.001, minQty: 0.001, minNotional: 20 }, '由st轉成之規則交build判定')
        assert.strictEqual(o.spyEntryQty, '0.008')
        //規則帶maxQty: 另加最小合法數量之試算1次
        assert.deepStrictEqual(o.spyEntryQ.map((x) => [x.f, x.opt.buffer, x.opt.units]), [['build', 0.1, 1], ['calc', 0.1, 1], ['calc', 0.1, 1]])
        assert.strictEqual(o.spyEntryQQty, '0.008')
        assert.strictEqual(o.blocked, 0, '不得有連外嘗試')
    })

})
