import get from 'lodash-es/get.js'
import cstr from 'wsemi/src/cstr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import getBinaClient from './getBinaClient.mjs'
import { readBinaAlgo, readBinaOrder } from './readBinaLeg.mjs'


//ID一律視為字串, 不經數值轉換以免進位成他單; 未給回null, 非正整數字串或安全整數為無效
let getIdStr = (o, key) => {
    let v = get(o, key, null)
    if (v === null || v === undefined || v === '') {
        return null
    }
    if (Number.isSafeInteger(v) && v > 0) {
        return String(v)
    }
    if (typeof v === 'string' && /^[1-9][0-9]*$/.test(v)) {
        return v
    }
    throw new Error(`invalid o.${key}: must be a positive integer or a numeric string`)
}


/**
 * 查進場與止損止盈三腳之實際狀態, 整體不拋錯(設定無效仍拋), 各腳以結果物件承載錯誤
 *
 * 每腳為{ found:true, ...單 }或{ found:false, errKind:'NOT_OBSERVED'|'UNKNOWN', code, msg }; 未給該腳之ID且無tdid時為null
 * NOT_OBSERVED只代表本次未見(剛下單與剛觸發有落後), 不得作未執行之定論; UNKNOWN為查詢失敗
 *
 * 觀察回調事件見callBinaRead
 *
 * @param {Object} st 設定物件
 * @param {Object} o 含idEntry、idTp、idSl(交易所ID)或tdid(以tdid_ENTRY、_SL、_TP查), 可只給tdid
 * @param {Object} [opt={}] forceTest, onTrace
 * @returns {Promise} resolve { tdid, idEntry, idTp, idSl, resEntry, resTp, resSl }
 */
let opBinaContractQueryOrderInfo = async(st, o, opt = {}) => {

    //check
    if (!iseobj(o)) {
        throw new Error(`invalid o: must be an object with tdid or order ids`)
    }
    let tdid = get(o, 'tdid', null)
    let idEntry = getIdStr(o, 'idEntry')
    let idTp = getIdStr(o, 'idTp')
    let idSl = getIdStr(o, 'idSl')
    if (!isestr(tdid) && idEntry === null && idTp === null && idSl === null) {
        throw new Error(`invalid o: must have tdid or at least one of idEntry, idTp, idSl`)
    }

    //client
    let { client, SYMBOL, recvWindow } = getBinaClient(st, opt)
    let onTrace = get(opt, 'onTrace', null)

    //queryRegular: 查普通單(entry使用)
    let queryRegular = async() => {
        if (idEntry !== null) {
            return readBinaOrder({ client, symbol: SYMBOL, recvWindow, req: { orderId: idEntry }, onTrace })
        }
        if (isestr(tdid)) {
            return readBinaOrder({ client, symbol: SYMBOL, recvWindow, req: { origClientOrderId: `${tdid}_ENTRY` }, onTrace })
        }
        return null
    }

    //queryAlgo: 查algo單(TP/SL使用), openAlgoOrders→queryAlgoOrder→未見
    let queryAlgo = async(algoId, suffix) => {
        if (algoId !== null) {
            return readBinaAlgo({ client, symbol: SYMBOL, recvWindow, req: { algoId }, onTrace })
        }
        if (isestr(tdid)) {
            return readBinaAlgo({ client, symbol: SYMBOL, recvWindow, req: { clientAlgoId: `${tdid}_${suffix}` }, onTrace })
        }
        return null
    }

    //依序查3筆(序列避免撞rate limit)
    let resEntry = await queryRegular()
    let resTp = await queryAlgo(idTp, 'TP')
    let resSl = await queryAlgo(idSl, 'SL')

    //r
    let r = {
        tdid: isestr(tdid) ? tdid : null,
        idEntry: idEntry !== null ? idEntry : (resEntry && resEntry.found ? cstr(resEntry.orderId) : null),
        idTp: idTp !== null ? idTp : (resTp && resTp.found ? cstr(resTp.algoId) : null),
        idSl: idSl !== null ? idSl : (resSl && resSl.found ? cstr(resSl.algoId) : null),
        resEntry,
        resTp,
        resSl,
    }
    // r {
    //   tdid: 'tdid-20260729213334-cB7pjm',
    //   idEntry: '14925106909',
    //   idTp: '1000000149617643',
    //   idSl: '1000000149617632',
    //   resEntry: {
    //     found: true,
    //     orderId: 14925106909,
    //     symbol: 'ETHUSDT',
    //     status: 'FILLED',          //'NEW' / 'FILLED' / 'CANCELED' / 'EXPIRED' ...
    //     clientOrderId: 'tdid-20260729213334-cB7pjm_ENTRY',
    //     avgPrice: '1908.17000',    //實際成交均價
    //     executedQty: '0.011',      //實際成交數量
    //     cumQuote: '20.98987',      //名義成交金額(USDT)
    //     ...
    //   },
    //   resTp: {
    //     found: true,
    //     algoId: 1000000149617643,
    //     symbol: 'ETHUSDT',
    //     algoStatus: 'NEW',         //'NEW' / 'CANCELED' / 'TRIGGERING' / 'FINISHED' ...
    //     clientAlgoId: 'tdid-20260729213334-cB7pjm_TP',
    //     triggerPrice: '2060.54',
    //     actualQty: '0.0',          //觸發後才有值
    //     actualOrderId: '',         //觸發後產生的普通單orderId(未觸發為空)
    //     ...
    //   },
    //   resSl: { found: false, errKind: 'NOT_OBSERVED', code: -2013, msg: 'Order does not exist.' }
    // }

    return r
}


export default opBinaContractQueryOrderInfo
