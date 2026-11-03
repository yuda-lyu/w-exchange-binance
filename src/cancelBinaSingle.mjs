import find from 'lodash-es/find.js'
import get from 'lodash-es/get.js'
import cdbl from 'wsemi/src/cdbl.mjs'
import cstr from 'wsemi/src/cstr.mjs'
import delay from 'wsemi/src/delay.mjs'
import getTrace from 'wsemi/src/getTrace.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import {
    BinaOpError, classifyBinaErr, sendBina, shapeArr, shapeCancel, shapeCode200, shapeObj, toBinaOpError, toBinanceInfo
} from './classifyBinaErr.mjs'
import { BINA_CLOCK_MARGIN_MS } from './getBinaClient.mjs'


let MAX_SENDS = 3


//撤單後NEW落後實測最大485ms, 下單後-2013落後實測最大1274ms
let QUERY_POLL_LIMIT_MS = 2000
let QUERY_POLL_GAP_MS = 300


//查得即不再開啟之狀態
let STATE_CLOSED = ['CANCELED', 'FILLED', 'EXPIRED', 'EXPIRED_IN_MATCH', 'REJECTED', 'FINISHED']


//解析取消目標: 字串或安全整數為交易所ID; 物件取一種ID. ID一律視為字串, 不經數值轉換以免進位成他單
let parseCancelTarget = (target, isAlgo) => {
    let keyId = isAlgo ? 'algoId' : 'orderId'
    let keyClient = isAlgo ? 'clientAlgoId' : 'clientOrderId'
    let id = null
    let clientId = null
    if (iseobj(target)) {
        id = get(target, keyId, null)
        clientId = get(target, keyClient, null)
    }
    else {
        id = target
    }
    if (clientId !== null && clientId !== undefined) {
        if (!isestr(clientId)) {
            throw new Error(`invalid ${keyClient}: must be a non-empty string`)
        }
        return { id: null, clientId }
    }
    if (Number.isSafeInteger(id) && id > 0) {
        return { id: String(id), clientId: null }
    }
    if (typeof id === 'string' && /^[1-9][0-9]*$/.test(id)) {
        return { id, clientId: null }
    }
    throw new Error(`invalid ${keyId}: must be a positive integer or a numeric string`)
}


/**
 * 取消單筆(普通或algo)之共用流程: 目標是這張單不再開啟, 已不開啟不是錯誤, 但要告知實際終局
 *
 * 觀察回調事件: cancelSend{id,n}, cancelDone{id,state}
 *
 * @param {Object} p client, symbol, isAlgo, target, recvWindow, onTrace
 * @returns {Promise} { state, alreadyClosed, positionChanged, executedQty, res }
 */
let cancelBinaSingle = async (p) => {

    let { client, symbol, isAlgo, recvWindow } = p
    let trace = getTrace(p)
    let { id, clientId } = p.target
    let tFirstWall = Date.now()

    let idLabel = () => {
        return id || clientId
    }

    let reqById = () => {
        if (isAlgo) {
            return id ? { algoId: id } : { clientAlgoId: clientId }
        }
        return id ? { orderId: id } : { origClientOrderId: clientId }
    }

    let qtyOf = (o) => {
        return isAlgo ? get(o, 'actualQty', '0') : get(o, 'executedQty', '0')
    }

    let finish = (state, alreadyClosed, res) => {
        let executedQty = res ? qtyOf(res) : '0'
        //NOT_FOUND未驗部位, 該單可能已觸發, 不得斷言未變
        let positionChanged = state === 'NOT_FOUND' ? null : (state === 'FILLED' || state === 'FINISHED' || state === 'TRIGGERING' || state === 'TRIGGERED' || cdbl(executedQty) > 0)
        if (trace) {
            trace('cancelDone', { id: idLabel(), state })
        }
        return { state, alreadyClosed, positionChanged, executedQty, res }
    }

    let failUnknown = (msg, err, state, attempts) => {
        let info = err ? classifyBinaErr(err) : null
        return new BinaOpError(`cancel failed: ${msg}`, {
            execState: 'unknown',
            binance: info ? toBinanceInfo(info, attempts) : null,
            cause: err || undefined,
            state,
        })
    }

    //單已不在開啟中時查清終局; 落後未解走拋錯
    let resolveClosed = async (attempts) => {
        let last = null
        let lastErr = null
        let sawNotFound = false
        let tq = performance.now()
        while (performance.now() - tq < QUERY_POLL_LIMIT_MS) {
            try {
                last = await sendBina(() => {
                    return isAlgo
                        ? client.restAPI.queryAlgoOrder({ ...reqById(), recvWindow })
                        : client.restAPI.queryOrder({ symbol, ...reqById(), recvWindow })
                }, shapeObj)
                lastErr = null
                sawNotFound = false
                let state = isAlgo ? get(last, 'algoStatus', '') : get(last, 'status', '')
                if (STATE_CLOSED.includes(state)) {
                    return finish(state, true, last)
                }
            }
            catch (err) {
                lastErr = err
                sawNotFound = classifyBinaErr(err).kind === 'notObserved'
                last = null
            }
            await delay(QUERY_POLL_GAP_MS)
        }
        if (sawNotFound) {
            return finish('NOT_FOUND', false, null) //剛掛之algo有查詢落後, 不設alreadyClosed
        }
        if (last) {
            let state = isAlgo ? get(last, 'algoStatus', '') : get(last, 'status', '')
            if (state === 'TRIGGERING' || state === 'TRIGGERED') {
                return finish(state, false, last) //部位正在變動, 呼叫端須查部位
            }
            throw failUnknown('state unresolved', null, { orderState: String(state), res: last }, attempts)
        }
        throw failUnknown('query failed', lastErr, {}, attempts)
    }

    //查開啟清單, 回該單或null; 查詢失敗拋錯
    let readOpen = async () => {
        let open = await sendBina(() => {
            return isAlgo
                ? client.restAPI.currentAllAlgoOpenOrders({ symbol, recvWindow })
                : client.restAPI.currentAllOpenOrders({ symbol, recvWindow })
        }, shapeArr)
        return find(open, (o) => {
            if (isAlgo) {
                return id ? cstr(get(o, 'algoId', '')) === id : get(o, 'clientAlgoId', '') === clientId
            }
            return id ? cstr(get(o, 'orderId', '')) === id : get(o, 'clientOrderId', '') === clientId
        }) || null
    }

    //普通單須狀態為CANCELED且為目標單; 否則當未知走查證
    let shapeCancelled = (b) => {
        if (isAlgo) {
            return shapeCode200(b)
        }
        return shapeCancel(b) && (id ? cstr(get(b, 'orderId', '')) === id : get(b, 'clientOrderId', '') === clientId)
    }

    let sawUnknown = false
    let lastErr = null
    for (let n = 1; n <= MAX_SENDS; n++) {

        if (trace) {
            trace('cancelSend', { id: idLabel(), n })
        }

        try {
            let res = await sendBina(() => {
                return isAlgo
                    ? client.restAPI.cancelAlgoOrder({ ...reqById(), recvWindow })
                    : client.restAPI.cancelOrder({ symbol, ...reqById(), recvWindow })
            }, shapeCancelled)
            return finish('CANCELED', false, res)
        }
        catch (err) {

            let info = classifyBinaErr(err)
            lastErr = err

            if (info.kind === 'notOpen') {
                return await resolveClosed(n)
            }
            if (info.execState === 'notExecuted') {
                //先未知後確定不可覆蓋
                throw toBinaOpError(err, { name: 'cancel', attempts: n, sawUnknown })
            }
            if (info.kind === 'rateLimited') {
                throw toBinaOpError(err, { name: 'cancel', attempts: n, sawUnknown }) //限流下不查不重送
            }

            sawUnknown = true

            let hit = null
            try {
                hit = await readOpen()
            }
            catch (errOpen) {
                throw failUnknown('open orders query failed', errOpen, {}, n)
            }
            if (!hit) {
                return await resolveClosed(n)
            }

            //以client ID取消者, 清單所見須為本次取消前已存在之單: client ID可重用, 原單已撤而同ID新單建立時不得撤到新單
            if (!id) {
                let tHit = Number(isAlgo ? get(hit, 'createTime', NaN) : get(hit, 'time', NaN))
                if (!Number.isFinite(tHit) || tHit > tFirstWall) {
                    throw failUnknown('open order with same client id is not the target', err, { orderState: 'OPEN_NOT_TARGET', res: hit }, n)
                }
            }

            //仍開啟: 以交易所ID重送(新簽章); client ID可重用, 用它重送可能撤到同ID新單
            id = isAlgo ? cstr(get(hit, 'algoId', '')) : cstr(get(hit, 'orderId', ''))

        }

    }

    throw failUnknown('sends exhausted', lastErr, {}, MAX_SENDS)
}


/**
 * 全撤之共用流程: 未知後查開啟清單, 空即成功並帶inFlightUntil, 不空不重送(可能是並行流程剛掛之止損)
 *
 * @param {Object} p client, symbol, isAlgo, recvWindow, onTrace
 * @returns {Promise} { state:'CANCELED_ALL', remaining:0, inFlightUntil, res }
 */
let cancelBinaAll = async (p) => {

    let { client, symbol, isAlgo, recvWindow } = p
    let trace = getTrace(p)
    let label = isAlgo ? 'allAlgo' : 'all'

    let tSign = Date.now()
    if (trace) {
        trace('cancelSend', { id: label, n: 1 })
    }

    try {
        let res = await sendBina(() => {
            return isAlgo
                ? client.restAPI.cancelAllAlgoOpenOrders({ symbol, recvWindow })
                : client.restAPI.cancelAllOpenOrders({ symbol, recvWindow })
        }, shapeCode200)
        if (trace) {
            trace('cancelDone', { id: label, state: 'CANCELED_ALL' })
        }
        return { state: 'CANCELED_ALL', remaining: 0, inFlightUntil: null, res }
    }
    catch (err) {

        let info = classifyBinaErr(err)
        if (info.execState === 'notExecuted' || info.kind === 'rateLimited') {
            throw toBinaOpError(err, { name: 'cancelAll' }) //限流下不查不重送, 同單筆
        }

        let open = null
        try {
            open = await sendBina(() => {
                return isAlgo
                    ? client.restAPI.currentAllAlgoOpenOrders({ symbol, recvWindow })
                    : client.restAPI.currentAllOpenOrders({ symbol, recvWindow })
            }, shapeArr)
        }
        catch (errOpen) {
            throw toBinaOpError(errOpen, { name: 'cancelAll', sawUnknown: true })
        }

        if (open.length > 0) {
            throw toBinaOpError(err, { name: 'cancelAll', state: { remaining: open } })
        }

        //原DELETE可能仍在途, 該時刻前新掛之單可能被撤
        let inFlightUntil = tSign + recvWindow + BINA_CLOCK_MARGIN_MS
        if (trace) {
            trace('cancelDone', { id: label, state: 'CANCELED_ALL' })
        }
        return { state: 'CANCELED_ALL', remaining: 0, inFlightUntil, res: null }
    }

}


export { parseCancelTarget, cancelBinaAll }
export default cancelBinaSingle
