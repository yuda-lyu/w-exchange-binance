import get from 'lodash-es/get.js'
import { cancelBinaAll } from './cancelBinaSingle.mjs'
import getBinaClient from './getBinaClient.mjs'


/**
 * 撤該SYMBOL所有「普通單」(走 /fapi/v1/order 路徑、NEW狀態的非algo單).
 * 典型用途: 測試帳號重置、緊急全撤. 注意:不會撤algo單(TP/SL條件單),請另呼叫 opBinaContractCancelAllAlgoOrder.
 *
 * 狀態未知時查開啟清單: 空即成功並帶inFlightUntil(原請求可能仍在途, 該時刻前新掛之單可能被撤); 不空不自動重送, 拋BinaOpError(err.execState='unknown', err.state.remaining)
 *
 * 觀察回調事件: cancelSend{id,n}, cancelDone{id,state}
 *
 * @param {Object} st 設定物件
 * @param {Object} [opt={}] forceTest, onTrace
 * @returns {Promise} resolve { state:'CANCELED_ALL', remaining:0, inFlightUntil, res }, reject BinaOpError
 */
let opBinaContractCancelAllOrder = async(st, opt = {}) => {

    //client
    let { client, SYMBOL, recvWindow } = getBinaClient(st, opt)

    //撤所有普通單
    return cancelBinaAll({ client, symbol: SYMBOL, isAlgo: false, recvWindow, onTrace: get(opt, 'onTrace', null) })
}


export default opBinaContractCancelAllOrder
