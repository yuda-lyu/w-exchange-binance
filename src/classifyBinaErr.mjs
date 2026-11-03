import get from 'lodash-es/get.js'
import cstr from 'wsemi/src/cstr.mjs'
import isenum from 'wsemi/src/isenum.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'


//確定未執行之白名單, 白名單外一律未知(預設放行會把未列舉或新增之代碼當確定未執行), 代價僅是多回查
let CODES_NOT_EXECUTED = new Set([
    -1021, -5028, -1022, -1102, -1111, -1121,
    -2015, -2018, -2019, -2021, -2022, -2024, -2025,
    -4005, -4015, -4045, -4061, -4164,
    -1003, -1015,
])


//幣安文件明載execution status unknown或文字模糊者, 讀取可重試
let CODES_UNKNOWN_RETRY = new Set([-1006, -1007, -1000, -1001, -1008])


//SDK錯誤類別對應之HTTP狀態碼; ConnectorClientError不保留狀態碼, ServerError自帶statusCode
let HTTP_BY_NAME = {
    BadRequestError: 400,
    UnauthorizedError: 401,
    ForbiddenError: 403,
    NotFoundError: 404,
    RateLimitBanError: 418,
    TooManyRequestsError: 429,
}


//回應本體無法解析或不符該站點成功形狀時之錯誤, 伺服器可能已處理, 故歸未知
class BinaBodyError extends Error {
    constructor(msg, cause) {
        super(msg, { cause })
        this.name = 'BinaBodyError'
    }
}


//本套件對外之錯誤類別, 呼叫端判err.execState與err.outcome, 不比對訊息
class BinaOpError extends Error {
    constructor(msg, { execState, binance = null, cause = undefined, outcome = undefined, state = undefined } = {}) {
        super(msg, { cause })
        this.name = 'BinaOpError'
        this.execState = execState
        this.binance = binance
        if (outcome !== undefined) {
            this.outcome = outcome
        }
        if (state !== undefined) {
            this.state = state
        }
    }
}


/**
 * 分類幣安SDK之錯誤, 為錯誤語意之單一來源
 *
 * execState: 'notExecuted'確定未執行, 'unknown'狀態未知
 * source: 'network'無回應, 'server'伺服器回報未知或回應不可判讀
 * retryRead: 讀取類可否由本套件重試
 *
 * @param {*} err SDK或本套件之錯誤
 * @returns {Object} { execState, kind, code, httpStatus, sdkErrorName, source, retryRead, msg }
 */
let classifyBinaErr = (err) => {

    let sdkErrorName = cstr(get(err, 'name', ''))
    let rawCode = get(err, 'code')
    let code = typeof rawCode === 'number' ? rawCode : null
    let msg = isestr(get(err, 'message', '')) ? err.message : ''

    let r = (execState, kind, source, retryRead, httpStatus) => {
        return { execState, kind, code, httpStatus, sdkErrorName, source, retryRead, msg }
    }

    if (sdkErrorName === 'NetworkError') {
        return r('unknown', 'network', 'network', true, null)
    }
    if (sdkErrorName === 'ServerError') {
        return r('unknown', 'server', 'server', true, get(err, 'statusCode', null))
    }
    if (sdkErrorName === 'ConnectorClientError') {
        return r('unknown', 'clientUnknown', 'server', true, null)
    }
    if (sdkErrorName === 'BinaBodyError') {
        return r('unknown', 'invalidBody', 'server', true, null)
    }
    if (sdkErrorName === 'RequiredError') {
        return r('notExecuted', 'notSent', null, false, null)
    }

    let httpStatus = get(HTTP_BY_NAME, sdkErrorName, null)
    if (httpStatus === null) {
        //非SDK已知類別, 不能判定是否已送出, 依預設未知
        return r('unknown', 'unexpected', 'server', false, null)
    }

    if (code === null) {
        let kindNoCode = httpStatus === 429 || httpStatus === 418 ? 'rateLimited' : 'noCode'
        return r('unknown', kindNoCode, 'server', false, httpStatus)
    }
    //以下三碼之語意只在對應站點成立(取消、查單、掛單), 由該站點依kind處置; 其他站點收到時不得當確定未執行, 故execState一律未知
    if (code === -2011) {
        return r('unknown', 'notOpen', 'server', false, httpStatus)
    }
    if (code === -2013) {
        return r('unknown', 'notObserved', 'server', false, httpStatus) //本次未觀察到, 不是不存在之定論
    }
    if (code === -4116) {
        return r('unknown', 'duplicate', 'server', false, httpStatus)
    }
    if (code === -4046 || code === -4059) {
        return r('unknown', 'noChange', 'server', false, httpStatus) //只在帳戶設定站點代表無須變更
    }
    if (CODES_UNKNOWN_RETRY.has(code)) {
        return r('unknown', 'serverUnknown', 'server', true, httpStatus)
    }
    let bRate = httpStatus === 429 || httpStatus === 418 || code === -1003 || code === -1015
    if (CODES_NOT_EXECUTED.has(code)) {
        return r('notExecuted', bRate ? 'rateLimited' : 'rejected', 'server', false, httpStatus)
    }
    return r('unknown', bRate ? 'rateLimited' : 'unlistedCode', 'server', false, httpStatus)
}


//由分類結果組err.binance, attempts為本操作實際送出次數
let toBinanceInfo = (info, attempts = 1) => {
    return {
        kind: info.kind,
        code: info.code,
        httpStatus: info.httpStatus,
        sdkErrorName: info.sdkErrorName,
        source: info.source,
        attempts,
        msg: info.msg,
    }
}


/**
 * 轉為BinaOpError, 原錯誤置於cause; 已是BinaOpError者原樣回傳
 *
 * @param {*} err 原錯誤
 * @param {Object} [opt={}] { name:操作名, attempts, sawUnknown:本操作先前已有未知(先未知後確定不可覆蓋), outcome, state }
 * @returns {BinaOpError}
 */
let toBinaOpError = (err, opt = {}) => {
    if (err instanceof BinaOpError) {
        return err
    }
    let info = classifyBinaErr(err)
    let execState = opt.sawUnknown ? 'unknown' : info.execState
    let code = info.code === null ? '' : ` code ${info.code}`
    return new BinaOpError(`${opt.name || 'binance request'} failed: ${info.kind}${code}`, {
        execState,
        binance: toBinanceInfo(info, opt.attempts || 1),
        cause: err,
        outcome: opt.outcome,
        state: opt.state,
    })
}


//單次送出: fn回SDK之Promise, 取回本體並檢查形狀, 本體問題一律轉BinaBodyError
let sendBina = async (fn, shape = null) => {
    let r = await fn()
    let body
    try {
        body = await r.data()
    }
    catch (err) {
        throw new BinaBodyError('invalid response body: not parseable', err)
    }
    if (shape && !shape(body)) {
        throw new BinaBodyError('invalid response body: unexpected shape')
    }
    return body
}


//數量相等比對, 字串與數字皆可, 交易所數量位數固定故容差取極小
let sameQty = (a, b) => {
    return Math.abs(Number(a) - Number(b)) < 1e-9
}


//各站點之成功形狀, 不符即未知; 幣安是否真會回200帶錯誤碼未查得, 此為防禦
let hasId = (v) => {
    return v !== null && v !== undefined && v !== ''
}
let shapeObj = (b) => {
    return iseobj(b) && !(typeof get(b, 'code') === 'number' && b.code < 0)
}
let shapeArr = (b) => {
    return Array.isArray(b)
}
let shapeEntry = (cid) => (b) => {
    return shapeObj(b) && hasId(b.orderId) && isestr(b.status) && b.clientOrderId === cid && isenum(b.executedQty)
}
//查單回應: 缺成交量不能證明零成交, 不完整者視為查詢失敗
let shapeOrderQuery = (cid) => (b) => {
    return shapeObj(b) && hasId(b.orderId) && isestr(b.status) && b.clientOrderId === cid && isenum(b.executedQty)
}
let shapeAlgo = (cid) => (b) => {
    return shapeObj(b) && hasId(b.algoId) && b.clientAlgoId === cid
}
let shapeCancel = (b) => {
    return shapeObj(b) && b.status === 'CANCELED'
}
let shapeCode200 = (b) => {
    return iseobj(b) && cstr(get(b, 'code', '')) === '200'
}
let shapeLeverage = (b) => {
    return shapeObj(b) && hasId(b.leverage)
}
let shapeMark = (b) => {
    return shapeObj(b) && isenum(b.markPrice)
}
//部位列須完整, 缺欄不得當0(會誤判未執行或撤掉真實保護); 只有完整回應中確實缺該方向才視為0
let shapePositions = (b) => {
    return Array.isArray(b) && b.every((p) => {
        return iseobj(p) && isestr(p.positionSide) && isenum(p.positionAmt)
    })
}
let shapeSymbols = (b) => {
    return shapeObj(b) && Array.isArray(b.symbols)
}


export {
    BinaBodyError,
    BinaOpError,
    classifyBinaErr,
    toBinanceInfo,
    toBinaOpError,
    sendBina,
    sameQty,
    shapeObj,
    shapeArr,
    shapeEntry,
    shapeOrderQuery,
    shapeAlgo,
    shapeCancel,
    shapeCode200,
    shapeLeverage,
    shapeMark,
    shapePositions,
    shapeSymbols
}
export default classifyBinaErr
