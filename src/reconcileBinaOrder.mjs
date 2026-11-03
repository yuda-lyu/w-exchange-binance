import get from 'lodash-es/get.js'
import cdbl from 'wsemi/src/cdbl.mjs'
import delay from 'wsemi/src/delay.mjs'
import getTrace from 'wsemi/src/getTrace.mjs'
import { classifyBinaErr, sameQty, sendBina, shapeOrderQuery, shapePositions } from './classifyBinaErr.mjs'
import { BINA_CLOCK_MARGIN_MS, BINA_RECV_WINDOW_MS } from './getBinaClient.mjs'


let POLL_MS = 500


//普通單實測首查即得, 此為查詢落後之餘裕
let QUERY_LAG_MARGIN_MS = 2000


//回查時與送單時刻之容差, 超過視為舊單
let IDENTITY_TIME_MARGIN_MS = 2000


let STATUS_TERMINAL = ['CANCELED', 'EXPIRED', 'REJECTED', 'EXPIRED_IN_MATCH']


//部位取該positionSide之量; positionRisk無部位時不回該列, 查無視同0
let getPosAmt = (positions, positionSide) => {
    let hit = null
    for (let p of positions) {
        if (get(p, 'positionSide', '') === positionSide) {
            hit = p
        }
    }
    return hit ? cdbl(get(hit, 'positionAmt', 0)) : 0
}


//查無之定論: 待裁示§9二, 暫依甲. 改依乙(一律維持未知)只需於本函數開頭回 { ok: false, reason: 'policyNoConclusion' }
let judgeNotExecuted = ({ lastNotFoundSentAt, tSign, source, posBefore, posAfter }) => {
    if (lastNotFoundSentAt === null || lastNotFoundSentAt < tSign + BINA_RECV_WINDOW_MS + BINA_CLOCK_MARGIN_MS) {
        return { ok: false, reason: 'noNotFoundAfterWindow' }
    }
    if (source !== 'network') {
        return { ok: false, reason: 'serverReportedUnknown' } //伺服器已收單而未回, 過窗查無仍未知
    }
    if (posBefore === null || posAfter === null) {
        return { ok: false, reason: 'positionUnread' }
    }
    if (!sameQty(posBefore, posAfter)) {
        return { ok: false, reason: 'positionChanged' }
    }
    return { ok: true, confirmedBy: 'notFoundAfterWindow+positionUnchanged' }
}


/**
 * 下單狀態未知時之回查狀態機, 只查不送, 判不了維持未知
 *
 * 觀察回調事件: reconcileQuery{cid,n,result,status,executedQty}, reconcileDone{cid,conclusion,reason,confirmedBy}
 *
 * @param {Object} p client, symbol, cid, side, positionSide, origQty, posBefore, tSign(單調時鐘), tSignWall, source, recvWindow, seed(送單回應已見之單,選用), onTrace
 * @returns {Promise} { conclusion:'filled'|'terminalZero'|'notExecuted'|'partial'|'unknown', executedQty, maxExecutedQty, order, reason, confirmedBy, tSign, conclusiveAfter }
 */
let reconcileBinaOrder = async (p) => {

    let { client, symbol, cid, side, positionSide, origQty, posBefore, tSign, tSignWall, source, recvWindow, seed } = p
    let trace = getTrace(p)

    let conclusiveAfter = tSignWall + BINA_RECV_WINDOW_MS + BINA_CLOCK_MARGIN_MS + QUERY_LAG_MARGIN_MS
    let deadline = tSign + BINA_RECV_WINDOW_MS + BINA_CLOCK_MARGIN_MS + QUERY_LAG_MARGIN_MS

    //seen與maxExecutedQty單調, 其後查無或失敗都不清除
    let seen = null
    let maxExecutedQty = '0'
    let lastNotFoundSentAt = null

    let note = (order) => {
        seen = order
        if (cdbl(get(order, 'executedQty', 0)) > cdbl(maxExecutedQty)) {
            maxExecutedQty = get(order, 'executedQty', '0')
        }
    }
    if (seed) {
        note(seed)
    }

    let done = (conclusion, extra = {}) => {
        let r = { conclusion, maxExecutedQty, order: seen, tSign: tSignWall, conclusiveAfter, reason: null, confirmedBy: null, executedQty: '0', ...extra }
        if (trace) {
            trace('reconcileDone', { cid, conclusion, reason: r.reason, confirmedBy: r.confirmedBy })
        }
        return r
    }

    for (let n = 1; performance.now() < deadline; n++) {

        let sentAt = performance.now()
        try {

            let order = await sendBina(() => client.restAPI.queryOrder({ symbol, origClientOrderId: cid, recvWindow }), shapeOrderQuery(cid))
            let status = get(order, 'status', '')
            if (trace) {
                trace('reconcileQuery', { cid, n, result: 'found', status: String(status), executedQty: String(get(order, 'executedQty', '')) })
            }

            let orderTime = Number(get(order, 'time', NaN))
            let bTimeOk = Number.isFinite(orderTime) && orderTime >= tSignWall - IDENTITY_TIME_MARGIN_MS
            if (!bTimeOk || get(order, 'side', '') !== side || !sameQty(get(order, 'origQty', NaN), origQty)) {
                //已知有成交量者不得因其後查得他單而遺失
                if (cdbl(maxExecutedQty) > 0) {
                    return done('partial', { reason: 'identityMismatch' })
                }
                return done('unknown', { reason: 'identityMismatch' })
            }

            let qtyNow = cdbl(get(order, 'executedQty', 0))
            let bBackward = qtyNow + 1e-12 < cdbl(maxExecutedQty)
            note(order)
            //成交量單調: 查得量倒退者回報矛盾, 不得判0成交或以較小量掛保護
            if (bBackward) {
                return done('partial', { reason: 'executedQtyBackward' })
            }
            //FILLED而成交量無效者不採信, 續查
            if (status === 'FILLED' && qtyNow > 0) {
                return done('filled', { executedQty: get(order, 'executedQty', '0') })
            }
            if (STATUS_TERMINAL.includes(status)) {
                if (qtyNow > 0) {
                    return done('filled', { executedQty: get(order, 'executedQty', '0') })
                }
                return done('terminalZero', { confirmedBy: `terminal:${status}` })
            }

        }
        catch (err) {

            let info = classifyBinaErr(err)
            if (info.kind === 'notObserved') {
                lastNotFoundSentAt = sentAt
                if (trace) {
                    trace('reconcileQuery', { cid, n, result: 'notFound', status: '', executedQty: '' })
                }
            }
            else if (info.kind === 'rateLimited') {
                if (trace) {
                    trace('reconcileQuery', { cid, n, result: 'rateLimited', status: '', executedQty: '' })
                }
                if (seen && cdbl(maxExecutedQty) > 0) {
                    return done('partial', { reason: 'rateLimited' })
                }
                return done('unknown', { reason: 'rateLimited' })
            }
            else if (trace) {
                trace('reconcileQuery', { cid, n, result: 'failed', status: '', executedQty: '' })
            }

        }

        let remain = deadline - performance.now()
        if (remain > 0) {
            await delay(Math.min(POLL_MS, remain))
        }

    }

    //到期
    if (seen && cdbl(maxExecutedQty) > 0) {
        return done('partial', { reason: 'unresolvedAfterDeadline' })
    }
    if (seen) {
        return done('unknown', { reason: 'seenNotFilled' }) //曾見存在, 不得判未執行
    }

    let posAfter = null
    try {
        let positions = await sendBina(() => client.restAPI.positionInformationV3({ symbol, recvWindow }), shapePositions)
        posAfter = getPosAmt(positions, positionSide)
    }
    catch (err) {
        posAfter = null
    }

    let judge = judgeNotExecuted({ lastNotFoundSentAt, tSign, source, posBefore, posAfter })
    if (judge.ok) {
        return done('notExecuted', { confirmedBy: judge.confirmedBy })
    }
    return done('unknown', { reason: judge.reason })
}


export { getPosAmt, judgeNotExecuted }
export default reconcileBinaOrder
