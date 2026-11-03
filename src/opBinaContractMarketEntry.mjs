import get from 'lodash-es/get.js'
import cdbl from 'wsemi/src/cdbl.mjs'
import genID from 'wsemi/src/genID.mjs'
import isenum from 'wsemi/src/isenum.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import binaInFlight from './binaInFlight.mjs'
import callBinaRead from './callBinaRead.mjs'
import { BinaOpError, classifyBinaErr, sendBina, shapeEntry, shapePositions, toBinanceInfo } from './classifyBinaErr.mjs'
import getBinaClient from './getBinaClient.mjs'
import { readBinaOrder } from './readBinaLeg.mjs'
import reconcileBinaOrder, { getPosAmt } from './reconcileBinaOrder.mjs'


//幣安之newClientOrderId限制
let REG_CLIENT_ORDER_ID = /^[.A-Z:/a-z0-9_-]{1,36}$/


/**
 * 下純市價單 (newOrder wrapper). 不含 TP/SL ─ 若要 entry+TP+SL 一包, 用 opBinaContractMarket.
 * 典型用途: 反向市價平倉、單純市價進出 (不需條件單時).
 *
 * 成交才回傳, 其餘拋BinaOpError, err.state.clientOrderId必帶. err.outcome:
 * - NOT_EXECUTED: 確定被拒、查得0成交終局、定論未執行或閘查詢失敗(err.state.stage為precheck, 指本次未送單)
 * - UNKNOWN: 狀態未知, 帶tSign、conclusiveAfter; 未過conclusiveAfter或未查清前不得以新ID重呼叫
 * - PARTIAL_UNKNOWN: 已知部分成交而終局未明(err.execState為'executed', 至少err.state.maxExecutedQty)
 * - ID_USED: 呼叫端給之clientOrderId已用過或同程序在途(err.state.reason='inFlight'); 本次未送單(err.state.sentThisCall為false), 前次可能已成交, 不得換新ID重下
 *
 * 平倉注意: 重複平倉或超量平倉會反向成負部位(測試端點實測; hedge模式不可傳reduceOnly), 本操作不代查部位(它也用於開倉, 且查詢與下單間本有競態), 平倉前呼叫端須自行查部位並以實際量下單, 並傳穩定之clientOrderId用於去重
 * 平倉與撤腿之順序: 先平有孤單反向窗, 先撤有裸倉窗, 無法兩全; 建議先撤另一腳以外之腿, 再平, 再撤其餘
 *
 * 部位快照讀不到時照送(緊急平倉不得因讀取失敗而不送), 此時回查判不了未執行, 未知即維持UNKNOWN
 *
 * 觀察回調事件見callBinaRead、reconcileBinaOrder
 *
 * @param {Object} st 設定物件
 * @param {String} SYMBOL 商品
 * @param {String} side 'BUY'或'SELL'
 * @param {String} positionSide 'LONG'、'SHORT'或'BOTH'
 * @param {Number|String} qty 數量(有效數字), 大於0
 * @param {Object} [opt={}] forceTest, clientOrderId(未給則自產; 用於去重, 給了而格式無效即拋, 不靜默換ID), onTrace
 * @returns {Promise} resolve成交單(含clientOrderId、notes), reject BinaOpError
 */
let opBinaContractMarketEntry = async(st, SYMBOL, side, positionSide, qty, opt = {}) => {

    //check
    if (!isestr(SYMBOL)) {
        throw new Error(`invalid SYMBOL: must be a non-empty string`)
    }
    if (side !== 'BUY' && side !== 'SELL') {
        throw new Error(`invalid side: must be 'BUY' or 'SELL'`)
    }
    if (positionSide !== 'LONG' && positionSide !== 'SHORT' && positionSide !== 'BOTH') {
        throw new Error(`invalid positionSide: must be 'LONG', 'SHORT' or 'BOTH'`)
    }
    if (!isenum(qty) || cdbl(qty) <= 0) {
        throw new Error(`invalid qty: must be a positive number`)
    }

    //clientOrderId: 未給則自產, 送出前即定. 此鍵攸關去重, 靜默換ID會讓每次重試都是新單, 故為K3之例外, 無效即拋
    let clientOrderIdOpt = get(opt, 'clientOrderId', null)
    let bGivenId = clientOrderIdOpt !== null && clientOrderIdOpt !== undefined
    if (bGivenId && (typeof clientOrderIdOpt !== 'string' || !REG_CLIENT_ORDER_ID.test(clientOrderIdOpt))) {
        throw new Error(`invalid opt.clientOrderId: must be a string of 1 to 36 characters from A-Z a-z 0-9 . : / _ -`)
    }
    let clientOrderId = bGivenId ? clientOrderIdOpt : `me-${Date.now()}-${genID(8)}`
    let onTrace = get(opt, 'onTrace', null)

    //client
    let { client, basePath, recvWindow } = getBinaClient(st, opt, { useSymbol: false })

    let state = { clientOrderId, stage: null, status: 'notSent', orderId: null, executedQty: null, maxExecutedQty: null, tSign: null, conclusiveAfter: null, confirmedBy: null, reason: null, res: null }

    let fail = (outcome, execState, err = null) => {
        let info = err ? classifyBinaErr(err) : null
        return new BinaOpError(`opBinaContractMarketEntry failed: ${outcome}`, {
            outcome,
            execState,
            state,
            binance: err && err.binance ? err.binance : (info ? toBinanceInfo(info) : null),
            cause: err || undefined,
        })
    }

    let core = async () => {

        //呼叫端給ID才過閘, 同ID已成交後重送會被接受而部位加倍
        if (bGivenId) {
            let gate = await readBinaOrder({ client, symbol: SYMBOL, recvWindow, req: { origClientOrderId: clientOrderId }, onTrace })
            if (gate.found) {
                state.status = 'found'
                state.res = gate
                state.sentThisCall = false
                throw fail('ID_USED', 'unknown')
            }
            if (gate.errKind !== 'NOT_OBSERVED') {
                state.stage = 'precheck'
                state.precheck = { errKind: gate.errKind, code: gate.code, msg: gate.msg }
                throw fail('NOT_EXECUTED', 'notExecuted')
            }
        }

        //部位快照, 回查判定用; 讀不到照送, 回查判不了未執行
        let posBefore = null
        try {
            let positions = await callBinaRead(() => client.restAPI.positionInformationV3({ symbol: SYMBOL, recvWindow }), { name: 'positionRisk', shape: shapePositions, onTrace })
            posBefore = getPosAmt(positions, positionSide)
        }
        catch (err) {
            posBefore = null
        }

        //下市價單, 未知一律先查不重送
        let quantity = cdbl(qty)
        let tSign = performance.now()
        let tSignWall = Date.now()
        state.tSign = tSignWall
        let res = null
        let source = null
        let seed = null
        let errSend = null
        try {
            res = await sendBina(() => client.restAPI.newOrder({
                symbol: SYMBOL,
                side,
                positionSide,
                type: 'MARKET',
                quantity,
                newClientOrderId: clientOrderId,
                newOrderRespType: 'RESULT',
                recvWindow,
            }), shapeEntry(clientOrderId))
            if (res.status !== 'FILLED' || cdbl(res.executedQty) <= 0) {
                source = 'server'
                seed = res
            }
        }
        catch (err) {
            let info = classifyBinaErr(err)
            errSend = err
            if (info.kind === 'duplicate') {
                state.status = 'found'
                state.sentThisCall = false
                throw fail('ID_USED', 'unknown', err)
            }
            if (info.execState === 'notExecuted') {
                state.status = 'rejected'
                state.stage = 'send'
                throw fail('NOT_EXECUTED', 'notExecuted', err)
            }
            source = info.source
        }

        if (source === null) {
            return { ...res, notes: [] }
        }

        //回查, 用實際下單參數
        let rec = await reconcileBinaOrder({
            client,
            symbol: SYMBOL,
            cid: clientOrderId,
            side,
            positionSide,
            origQty: quantity,
            posBefore,
            tSign,
            tSignWall,
            source,
            seed,
            recvWindow,
            onTrace,
        })
        state.tSign = rec.tSign
        state.conclusiveAfter = rec.conclusiveAfter
        state.confirmedBy = rec.confirmedBy
        state.reason = rec.reason
        state.maxExecutedQty = rec.maxExecutedQty
        state.res = rec.order
        if (rec.conclusion === 'filled') {
            return { ...rec.order, notes: ['entry:reconciled'] }
        }
        if (rec.conclusion === 'terminalZero' || rec.conclusion === 'notExecuted') {
            state.status = 'notExecuted'
            state.stage = 'send'
            throw fail('NOT_EXECUTED', 'notExecuted')
        }
        state.status = rec.conclusion
        if (rec.conclusion === 'partial') {
            throw fail('PARTIAL_UNKNOWN', 'executed', errSend)
        }
        throw fail('UNKNOWN', 'unknown', errSend)
    }

    if (!bGivenId) {
        return core()
    }

    //同程序在途防護, 與Market共用, 鍵為實際之進場ID: 閘只能擋已見之單, 同時呼叫時兩者皆過閘
    let keyInFlight = `${basePath}|${clientOrderId}`
    if (binaInFlight.has(keyInFlight)) {
        state.reason = 'inFlight'
        state.sentThisCall = false
        state.previous = binaInFlight.get(keyInFlight)
        throw fail('ID_USED', 'unknown')
    }
    binaInFlight.set(keyInFlight, state)
    let keepInFlight = false
    try {
        return await core()
    }
    catch (err) {
        keepInFlight = err.outcome === 'UNKNOWN' || err.outcome === 'PARTIAL_UNKNOWN'
        throw err
    }
    finally {
        if (!keepInFlight) {
            binaInFlight.delete(keyInFlight)
        }
    }
}


export default opBinaContractMarketEntry
