import get from 'lodash-es/get.js'
import cancelBinaSingle, { parseCancelTarget } from './cancelBinaSingle.mjs'
import getBinaClient from './getBinaClient.mjs'


/**
 * 取消algo單(止損止盈): 目標是這張單不再開啟, 已不開啟不是錯誤, 但要告知實際終局
 *
 * 回傳state: CANCELED, FINISHED, EXPIRED, REJECTED, TRIGGERING, TRIGGERED, NOT_FOUND. 判不了或未查清時拋BinaOpError(err.execState='unknown'), 呼叫端不可視為已撤
 * alreadyClosed只在查得終局時為true; NOT_FOUND不設(剛掛之algo有查詢落後); positionChanged為true時部位已變或正在變動, 呼叫端須查部位
 *
 * 觀察回調事件: cancelSend{id,n}, cancelDone{id,state}
 *
 * @param {Object} st 設定物件
 * @param {String|Number|Object} algoId 交易所ID(數字字串或安全整數), 或{ algoId }、{ clientAlgoId }
 * @param {Object} [opt={}] forceTest, onTrace
 * @returns {Promise} resolve { state, alreadyClosed, positionChanged, executedQty, res }, reject BinaOpError
 */
let opBinaContractCancelAlgoOrder = async(st, algoId, opt = {}) => {

    //check
    let target = parseCancelTarget(algoId, true)

    //client
    let { client, SYMBOL, recvWindow } = getBinaClient(st, opt)

    //cancel
    return cancelBinaSingle({ client, symbol: SYMBOL, isAlgo: true, target, recvWindow, onTrace: get(opt, 'onTrace', null) })
}


export default opBinaContractCancelAlgoOrder
