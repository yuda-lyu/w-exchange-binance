import find from 'lodash-es/find.js'
import get from 'lodash-es/get.js'
import cstr from 'wsemi/src/cstr.mjs'
import callBinaRead from './callBinaRead.mjs'
import { shapeArr, shapeObj } from './classifyBinaErr.mjs'


//查無與查詢失敗分開: NOT_OBSERVED只代表本次未見, 剛下單與剛觸發有落後, 不得作未執行之定論
let getNotFound = (err) => {
    let kind = get(err, 'binance.kind', '')
    return {
        found: false,
        errKind: kind === 'notObserved' ? 'NOT_OBSERVED' : 'UNKNOWN',
        code: get(err, 'binance.code', null),
        msg: get(err, 'binance.msg', ''),
    }
}


//查普通單, req為{orderId}或{origClientOrderId}, 回{found:true,...單}或{found:false,errKind,code,msg}
let readBinaOrder = async ({ client, symbol, recvWindow, req, onTrace }) => {
    try {
        let o = await callBinaRead(() => client.restAPI.queryOrder({ symbol, ...req, recvWindow }), { name: 'queryOrder', shape: shapeObj, onTrace })
        return { found: true, ...o }
    }
    catch (err) {
        return getNotFound(err)
    }
}


//查algo單, req為{algoId}或{clientAlgoId}: openAlgoOrders下單與撤單後首查即反映, 其後queryAlgoOrder補已觸發與已撤者
let readBinaAlgo = async ({ client, symbol, recvWindow, req, onTrace }) => {

    let errOpen = null
    try {
        let open = await callBinaRead(() => client.restAPI.currentAllAlgoOpenOrders({ symbol, recvWindow }), { name: 'openAlgoOrders', shape: shapeArr, onTrace })
        let hit = find(open, (o) => {
            return req.algoId ? cstr(get(o, 'algoId', '')) === cstr(req.algoId) : get(o, 'clientAlgoId', '') === req.clientAlgoId
        })
        if (hit) {
            return { found: true, ...hit }
        }
    }
    catch (err) {
        errOpen = err
    }

    try {
        let q = await callBinaRead(() => client.restAPI.queryAlgoOrder({ ...req, recvWindow }), { name: 'queryAlgoOrder', shape: shapeObj, onTrace })
        return { found: true, ...q }
    }
    catch (err) {
        return getNotFound(errOpen || err)
    }

}


export { readBinaOrder, readBinaAlgo, getNotFound }
