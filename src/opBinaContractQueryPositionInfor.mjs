import get from 'lodash-es/get.js'
import callBinaRead from './callBinaRead.mjs'
import { shapePositions } from './classifyBinaErr.mjs'
import getBinaClient from './getBinaClient.mjs'


/**
 * 查 settings.symbol 的持倉詳細資料 (走 /fapi/v3/positionRisk = positionInformationV3).
 * 回傳陣列: hedge mode 每個 positionSide (LONG/SHORT) 一筆; one-way mode 只一筆 (BOTH); 無部位時不回該列.
 * 欄位含 entryPrice/breakEvenPrice/markPrice/unRealizedProfit/liquidationPrice/notional/positionAmt/positionSide 等.
 * 比 accountInformationV3.positions 更詳細(多 entryPrice/markPrice/liquidationPrice 等).
 * 讀取失敗拋BinaOpError(err.execState、err.binance.attempts)
 *
 * @param {Object} st 設定物件
 * @param {Object} [opt={}] forceTest, onTrace
 * @returns {Promise} resolve持倉陣列
 */
let opBinaContractQueryPositionInfor = async(st, opt = {}) => {

    //client
    let { client, SYMBOL, recvWindow } = getBinaClient(st, opt)

    //持倉
    return callBinaRead(() => client.restAPI.positionInformationV3({ symbol: SYMBOL, recvWindow }), { name: 'positionRisk', shape: shapePositions, onTrace: get(opt, 'onTrace', null) })
}


export default opBinaContractQueryPositionInfor
