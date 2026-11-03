import get from 'lodash-es/get.js'
import cancelBinaSingle, { parseCancelTarget } from './cancelBinaSingle.mjs'
import getBinaClient from './getBinaClient.mjs'


/**
 * 取消普通單: 目標是這張單不再開啟, 已不開啟不是錯誤, 但要告知實際終局
 *
 * 回傳state: CANCELED, FILLED, EXPIRED, EXPIRED_IN_MATCH, REJECTED, NOT_FOUND. 判不了或未查清時拋BinaOpError(err.execState='unknown'), 呼叫端不可視為已撤
 * alreadyClosed只在查得終局時為true; positionChanged為true時部位已變, 呼叫端須判讀
 *
 * 觀察回調事件: cancelSend{id,n}, cancelDone{id,state}
 *
 * @param {Object} st 設定物件
 * @param {String|Number|Object} orderId 交易所ID(數字字串或安全整數), 或{ orderId }、{ clientOrderId }
 * @param {Object} [opt={}] forceTest, onTrace
 * @returns {Promise} resolve { state, alreadyClosed, positionChanged, executedQty, res }, reject BinaOpError
 */
let opBinaContractCancelOrder = async(st, orderId, opt = {}) => {

    //check
    let target = parseCancelTarget(orderId, false)

    //client
    let { client, SYMBOL, recvWindow } = getBinaClient(st, opt)

    //cancel
    return cancelBinaSingle({ client, symbol: SYMBOL, isAlgo: false, target, recvWindow, onTrace: get(opt, 'onTrace', null) })
    // res {
    //   orderId: 7605276918,
    //   symbol: 'ETHUSDT',
    //   status: 'CANCELED',
    //   clientOrderId: 'tdid-20251206194325-Zqaa49_TP',
    //   price: '0.00',
    //   origQty: '0.007',
    //   executedQty: '0.000',
    //   cumQty: '0.000',
    //   timeInForce: 'GTC',
    //   type: 'TAKE_PROFIT_MARKET',
    //   reduceOnly: true,
    //   closePosition: false,
    //   side: 'SELL',
    //   positionSide: 'BOTH',
    //   stopPrice: '3048.87',
    //   workingType: 'MARK_PRICE',
    //   priceProtect: false,
    //   origType: 'TAKE_PROFIT_MARKET',
    //   priceMatch: 'NONE',
    //   selfTradePreventionMode: 'EXPIRE_MAKER',
    //   goodTillDate: 0,
    //   updateTime: 1765024172313
    // }
}


export default opBinaContractCancelOrder
