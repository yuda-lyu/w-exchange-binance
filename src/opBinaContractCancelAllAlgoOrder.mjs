import get from 'lodash-es/get.js'
import { cancelBinaAll } from './cancelBinaSingle.mjs'
import getBinaClient from './getBinaClient.mjs'


/**
 * 撤該SYMBOL所有「algo單」(走 /fapi/v1/algoOrder 路徑, 即2025-12-09起 TP/SL 條件單必走的路).
 * 典型用途: 測試帳號重置、緊急全撤. 注意:不會撤普通單(MARKET/LIMIT/舊式條件單),請另呼叫 opBinaContractCancelAllOrder.
 *
 * 狀態未知時查開啟清單: 空即成功並帶inFlightUntil(原請求可能仍在途, 該時刻前新掛之單可能被撤); 不空不自動重送, 拋BinaOpError(err.execState='unknown', err.state.remaining)
 *
 * 觀察回調事件: cancelSend{id,n}, cancelDone{id,state}
 *
 * @param {Object} st 設定物件
 * @param {Object} [opt={}] forceTest, onTrace
 * @returns {Promise} resolve { state:'CANCELED_ALL', remaining:0, inFlightUntil, res }, reject BinaOpError
 */
let opBinaContractCancelAllAlgoOrder = async(st, opt = {}) => {

    //client
    let { client, SYMBOL, recvWindow } = getBinaClient(st, opt)

    //撤所有algo單
    return cancelBinaAll({ client, symbol: SYMBOL, isAlgo: true, recvWindow, onTrace: get(opt, 'onTrace', null) })
}


export default opBinaContractCancelAllAlgoOrder
