import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import getBinaClient from './getBinaClient.mjs'
import { readBinaAlgo, readBinaOrder } from './readBinaLeg.mjs'


/**
 * 以自訂ID查單, 供下單狀態未知時回查. 查詢結果以結果物件承載, 不因查無或網路失敗而拋錯(設定無效仍拋)
 *
 * errKind: 'NOT_OBSERVED'只代表本次未見(剛下單與剛觸發有落後), 不得作未執行之定論; 'UNKNOWN'為查詢失敗
 *
 * 觀察回調事件見callBinaRead
 *
 * @param {Object} st 設定物件
 * @param {Object} ids { clientOrderId }普通單或{ clientAlgoId }algo單, 擇一
 * @param {Object} [opt={}] forceTest, symbol(預設st.symbol), onTrace
 * @returns {Promise} resolve { found, order, errKind, code, msg }
 */
let opBinaContractQueryOrderByClientId = async(st, ids, opt = {}) => {

    //check
    if (!iseobj(ids)) {
        throw new Error(`invalid ids: must be an object with clientOrderId or clientAlgoId`)
    }
    let clientOrderId = get(ids, 'clientOrderId', null)
    let clientAlgoId = get(ids, 'clientAlgoId', null)
    if (isestr(clientOrderId) === isestr(clientAlgoId)) {
        throw new Error(`invalid ids: must have exactly one of clientOrderId, clientAlgoId as a non-empty string`)
    }

    //client
    let symbolOpt = get(opt, 'symbol', '')
    let { client, SYMBOL, recvWindow } = getBinaClient(st, opt, { useSymbol: !isestr(symbolOpt) })
    let symbol = isestr(symbolOpt) ? symbolOpt : SYMBOL
    let onTrace = get(opt, 'onTrace', null)

    //查
    let r = isestr(clientOrderId)
        ? await readBinaOrder({ client, symbol, recvWindow, req: { origClientOrderId: clientOrderId }, onTrace })
        : await readBinaAlgo({ client, symbol, recvWindow, req: { clientAlgoId }, onTrace })
    if (r.found) {
        let { found, ...order } = r
        return { found, order, errKind: null, code: null, msg: '' }
    }
    return { found: false, order: null, errKind: r.errKind, code: r.code, msg: r.msg }
}


export default opBinaContractQueryOrderByClientId
