import assert from 'assert'
import { BadRequestError, ConnectorClientError, ForbiddenError, NetworkError, NotFoundError, RateLimitBanError, RequiredError, ServerError, TooManyRequestsError, UnauthorizedError } from '@binance/common'
import classifyBinaErr, { BinaBodyError, BinaOpError, toBinaOpError } from '../src/classifyBinaErr.mjs'


//錯誤分類單一來源(bx297 §5.2): 預設未知, 確定被拒採白名單
describe('classifyBinaErr 錯誤分類 (不連網)', function() {

    let WHITELIST = [-1021, -5028, -1022, -1102, -1111, -1121, -2015, -2018, -2019, -2021, -2022, -2024, -2025, -4005, -4015, -4045, -4061, -4164, -1003, -1015]
    let UNKNOWN_RETRY = [-1006, -1007, -1000, -1001, -1008]

    it('§5.2 無回應為未知、source:network、讀取可重試', () => {
        let r = classifyBinaErr(new NetworkError('x'))
        assert.strictEqual(r.execState, 'unknown')
        assert.strictEqual(r.source, 'network')
        assert.strictEqual(r.retryRead, true)
    })

    it('§5.2 任何5xx為未知、source:server、保留狀態碼、讀取可重試', () => {
        for (let status of [500, 502, 503, 504, 599]) {
            let r = classifyBinaErr(new ServerError('x', status))
            assert.strictEqual(r.execState, 'unknown')
            assert.strictEqual(r.source, 'server')
            assert.strictEqual(r.httpStatus, status)
            assert.strictEqual(r.retryRead, true)
        }
    })

    it('§5.2 ConnectorClientError(含408)不論有無代碼皆未知、讀取可重試', () => {
        for (let code of [undefined, -1007, -2019]) {
            let r = classifyBinaErr(new ConnectorClientError('x', code))
            assert.strictEqual(r.execState, 'unknown')
            assert.strictEqual(r.source, 'server')
            assert.strictEqual(r.retryRead, true)
        }
    })

    it('§5.2 幣安未知碼為未知、source:server、讀取可重試', () => {
        for (let code of UNKNOWN_RETRY) {
            let r = classifyBinaErr(new BadRequestError('x', code))
            assert.strictEqual(r.execState, 'unknown', `code ${code}`)
            assert.strictEqual(r.source, 'server', `code ${code}`)
            assert.strictEqual(r.retryRead, true, `code ${code}`)
        }
    })

    it('§5.2 白名單20碼逐一為確定未執行且不重試', () => {
        assert.strictEqual(WHITELIST.length, 20)
        for (let code of WHITELIST) {
            let r = classifyBinaErr(new BadRequestError('x', code))
            assert.strictEqual(r.execState, 'notExecuted', `code ${code}`)
            assert.strictEqual(r.retryRead, false, `code ${code}`)
        }
    })

    it('§5.2 白名單外之帶碼4xx一律未知(預設不放行)', () => {
        for (let code of [-9999, -4000, -2010, -1020, -2012, -5000, 0, 1]) {
            let r = classifyBinaErr(new BadRequestError('x', code))
            assert.strictEqual(r.execState, 'unknown', `code ${code}`)
            assert.strictEqual(r.retryRead, false, `code ${code}`)
        }
    })

    it('§5.2 4xx無數字代碼(WAF HTML、404)為未知且不重試', () => {
        for (let e of [new BadRequestError('x'), new UnauthorizedError('x'), new ForbiddenError('x'), new NotFoundError('x')]) {
            let r = classifyBinaErr(e)
            assert.strictEqual(r.execState, 'unknown', e.name)
            assert.strictEqual(r.source, 'server', e.name)
            assert.strictEqual(r.retryRead, false, e.name)
        }
    })

    it('§5.2 429、418: 有白名單代碼確定未執行且不重試, 無代碼未知', () => {
        assert.strictEqual(classifyBinaErr(new TooManyRequestsError('x', -1015)).execState, 'notExecuted')
        assert.strictEqual(classifyBinaErr(new RateLimitBanError('x', -1003)).execState, 'notExecuted')
        assert.strictEqual(classifyBinaErr(new TooManyRequestsError('x')).execState, 'unknown')
        assert.strictEqual(classifyBinaErr(new RateLimitBanError('x')).execState, 'unknown')
        assert.strictEqual(classifyBinaErr(new TooManyRequestsError('x')).kind, 'rateLimited')
        assert.strictEqual(classifyBinaErr(new TooManyRequestsError('x', -1015)).retryRead, false)
    })

    it('§5.2 429、418帶白名單外代碼: kind仍為rateLimited(回查須停止輪詢), execState未知', () => {
        for (let e of [new TooManyRequestsError('x', -9999), new RateLimitBanError('x', -9999)]) {
            let r = classifyBinaErr(e)
            assert.strictEqual(r.kind, 'rateLimited', e.name)
            assert.strictEqual(r.execState, 'unknown', e.name)
        }
    })

    it('§5.2 只在對應站點成立之碼: 分類本身一律未知, 其他站點收到不得當確定未執行', () => {
        for (let code of [-2011, -4046, -4059]) {
            assert.strictEqual(classifyBinaErr(new BadRequestError('x', code)).execState, 'unknown', `code ${code}`)
        }
    })

    it('§5.2 特殊碼: -2011已不開啟、-2013未觀察到(非未執行定論)、-4116佔位、-4046/-4059無須變更', () => {
        assert.strictEqual(classifyBinaErr(new BadRequestError('x', -2011)).kind, 'notOpen')
        let nf = classifyBinaErr(new BadRequestError('x', -2013))
        assert.strictEqual(nf.kind, 'notObserved')
        assert.strictEqual(nf.execState, 'unknown')
        assert.strictEqual(nf.retryRead, false)
        assert.strictEqual(classifyBinaErr(new BadRequestError('x', -4116)).kind, 'duplicate')
        assert.strictEqual(classifyBinaErr(new BadRequestError('x', -4046)).kind, 'noChange')
        assert.strictEqual(classifyBinaErr(new BadRequestError('x', -4059)).kind, 'noChange')
    })

    it('§5.2 未送出(RequiredError)確定未執行且不重試', () => {
        let r = classifyBinaErr(new RequiredError('symbol'))
        assert.strictEqual(r.execState, 'notExecuted')
        assert.strictEqual(r.retryRead, false)
    })

    it('§5.2 本體不符為未知、source:server、讀取可重試', () => {
        let r = classifyBinaErr(new BinaBodyError('x'))
        assert.strictEqual(r.execState, 'unknown')
        assert.strictEqual(r.source, 'server')
        assert.strictEqual(r.retryRead, true)
    })

    it('§5.2 非SDK已知錯誤預設未知, source不得為network(否則可能被判未執行)', () => {
        for (let e of [new Error('x'), new TypeError('x'), 'str', null, undefined, { code: -2019 }]) {
            let r = classifyBinaErr(e)
            assert.strictEqual(r.execState, 'unknown')
            assert.notStrictEqual(r.source, 'network')
        }
    })

    it('§5.2 先未知後確定不可覆蓋: sawUnknown時白名單代碼仍為未知', () => {
        let e1 = toBinaOpError(new BadRequestError('x', -1021), { name: 'op' })
        assert.strictEqual(e1.execState, 'notExecuted')
        let e2 = toBinaOpError(new BadRequestError('x', -1021), { name: 'op', sawUnknown: true })
        assert.strictEqual(e2.execState, 'unknown')
    })

    it('§5.2 BinaOpError帶binance欄位, 原錯在cause, 已是BinaOpError者原樣回傳', () => {
        let src = new BadRequestError('Margin is insufficient.', -2019)
        let e = toBinaOpError(src, { name: 'op', attempts: 2 })
        assert.ok(e instanceof BinaOpError)
        assert.strictEqual(e.cause, src)
        assert.deepStrictEqual(
            { kind: e.binance.kind, code: e.binance.code, httpStatus: e.binance.httpStatus, sdkErrorName: e.binance.sdkErrorName, attempts: e.binance.attempts },
            { kind: 'rejected', code: -2019, httpStatus: 400, sdkErrorName: 'BadRequestError', attempts: 2 },
        )
        assert.strictEqual(toBinaOpError(e), e)
    })

})
