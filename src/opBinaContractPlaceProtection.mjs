import get from 'lodash-es/get.js'
import cdbl from 'wsemi/src/cdbl.mjs'
import delay from 'wsemi/src/delay.mjs'
import isenum from 'wsemi/src/isenum.mjs'
import callBinaRead from './callBinaRead.mjs'
import { BinaOpError, classifyBinaErr, shapePositions, toBinanceInfo } from './classifyBinaErr.mjs'
import getBinaClient from './getBinaClient.mjs'
import { REG_TDID } from './opBinaContractMarket.mjs'
import placeBinaProtect, { GAP_MS, getProtectOutcome } from './placeBinaProtect.mjs'
import { getPosAmt } from './reconcileBinaOrder.mjs'


/**
 * 依部位補掛止損止盈, 不自動平倉時呼叫端用以接手ENTERED類outcome
 *
 * 入口查部位: 查詢失敗拋err.outcome='POSITION_UNREAD', 部位不足或反向拋'POSITION_INSUFFICIENT', 皆未送單(err.execState='notExecuted')
 * 同clientAlgoId開啟中而量價不符回conflict, 不得把舊單當已掛; 同ID已觸發者不再送(觸發後ID不佔位, 再送會多一張), 回triggered, 要另掛須換新tdid
 *
 * 兩腳皆掛上才回傳, 其餘依同一outcome表拋BinaOpError(ENTERED_SL_ONLY等, err.state.sl、err.state.tp帶各腳狀態); 止損triggered時止盈不送
 * err.execState依兩腳實況: 有掛上或已觸發為'executed', 否則有未知為'unknown', 皆確定未掛為'notExecuted'
 *
 * 多tdid共用部位時本操作不比對他單合計, 超量由opBinaContractCancelResidualOrders以oversized回報
 *
 * 觀察回調事件見callBinaRead、placeBinaProtect
 *
 * @param {Object} st 設定物件
 * @param {String} tdid 交易識別字, 實際ID為tdid_SL、tdid_TP
 * @param {String} mode 'long'或'short'
 * @param {Number|String} quantity 數量(有效數字), 大於0
 * @param {Number|String} priceStopLoss 止損觸發價(有效數字), 大於0
 * @param {Number|String} priceTakeProfit 止盈觸發價(有效數字), 大於0
 * @param {Object} [opt={}] forceTest, onTrace
 * @returns {Promise} resolve { idTrade, sl, tp }, reject BinaOpError
 */
let opBinaContractPlaceProtection = async(st, tdid, mode, quantity, priceStopLoss, priceTakeProfit, opt = {}) => {

    //check
    if (typeof tdid !== 'string' || !REG_TDID.test(tdid)) {
        throw new Error(`invalid tdid: must be a string of 1 to 30 characters from A-Z a-z 0-9 . : / -`)
    }
    if (mode !== 'long' && mode !== 'short') {
        throw new Error(`invalid mode: must be 'long' or 'short'`)
    }
    if (!isenum(quantity) || cdbl(quantity) <= 0) {
        throw new Error(`invalid quantity: must be a positive number`)
    }
    if (!isenum(priceStopLoss) || cdbl(priceStopLoss) <= 0) {
        throw new Error(`invalid priceStopLoss: must be a positive number`)
    }
    if (!isenum(priceTakeProfit) || cdbl(priceTakeProfit) <= 0) {
        throw new Error(`invalid priceTakeProfit: must be a positive number`)
    }

    //client
    let { client, SYMBOL, recvWindow } = getBinaClient(st, opt)
    let onTrace = get(opt, 'onTrace', null)

    //sideOut, pos
    let sideOut = mode === 'short' ? 'BUY' : 'SELL'
    let pos = mode === 'short' ? 'SHORT' : 'LONG'
    let dirPos = mode === 'short' ? -1 : 1

    //入口查部位
    let amt = 0
    try {
        let positions = await callBinaRead(() => client.restAPI.positionInformationV3({ symbol: SYMBOL, recvWindow }), { name: 'positionRisk', shape: shapePositions, onTrace })
        amt = getPosAmt(positions, pos)
    }
    catch (err) {
        throw new BinaOpError(`opBinaContractPlaceProtection failed: POSITION_UNREAD`, {
            outcome: 'POSITION_UNREAD',
            execState: 'notExecuted',
            state: { tdid },
            binance: err.binance || toBinanceInfo(classifyBinaErr(err)),
            cause: err,
        })
    }
    if (amt * dirPos + 1e-9 < cdbl(quantity)) {
        throw new BinaOpError(`opBinaContractPlaceProtection failed: POSITION_INSUFFICIENT`, {
            outcome: 'POSITION_INSUFFICIENT',
            execState: 'notExecuted',
            state: { tdid, positionSide: pos, positionAmt: amt },
        })
    }

    let protectBase = {
        client,
        symbol: SYMBOL,
        side: sideOut,
        positionSide: pos,
        quantity,
        minPos: Math.abs(amt),
        precheck: true,
        recvWindow,
        onTrace,
    }

    let state = { tdid, sl: null, tp: { status: 'notSent', algoId: null, clientAlgoId: `${tdid}_TP`, reason: null, tSign: null, conclusiveAfter: null, res: null } }

    //止損
    state.sl = await placeBinaProtect({ ...protectBase, cid: `${tdid}_SL`, type: 'STOP_MARKET', triggerPrice: priceStopLoss })

    //止損triggered即不掛止盈
    if (state.sl.status !== 'triggered') {

        //幣安帶單有下單速率限制20筆/10s, 每單至少500ms
        await delay(GAP_MS)

        //止盈
        state.tp = await placeBinaProtect({ ...protectBase, cid: `${tdid}_TP`, type: 'TAKE_PROFIT_MARKET', triggerPrice: priceTakeProfit })

    }

    let outcome = getProtectOutcome(state.sl, state.tp)
    if (outcome !== null) {
        let ss = [state.sl.status, state.tp.status]
        let execState = 'notExecuted'
        if (ss.includes('placed') || ss.includes('triggered')) {
            execState = 'executed'
        }
        else if (ss.includes('unknown')) {
            execState = 'unknown'
        }
        throw new BinaOpError(`opBinaContractPlaceProtection failed: ${outcome}`, { outcome, execState, state })
    }

    return { idTrade: tdid, sl: state.sl, tp: state.tp }
}


export default opBinaContractPlaceProtection
