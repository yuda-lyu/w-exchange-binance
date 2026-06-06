import each from 'lodash-es/each.js'
import filter from 'lodash-es/filter.js'
import get from 'lodash-es/get.js'
import groupBy from 'lodash-es/groupBy.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import isestr from 'wsemi/src/isestr.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import sep from 'wsemi/src/sep.mjs'
import opBinaContractListOrders from './opBinaContractListOrders.mjs'
import opBinaContractCancelOrder from './opBinaContractCancelOrder.mjs'
import opBinaContractCancelAlgoOrder from './opBinaContractCancelAlgoOrder.mjs'


let opBinaContractCancelResidualOrders = async(st, opt = {}) => {

    //orders
    let orders = await opBinaContractListOrders(st)
    // console.log('orders', orders)

    //check
    if (size(orders) === 0) {
        return []
    }

    //add tdid, kind
    orders = map(orders, (o) => {

        //clientOrderId
        let clientOrderId = get(o, 'clientOrderId', '')

        //tdid, kind
        let ss = sep(clientOrderId, '_')
        let tdid = get(ss, 0, '')
        let kind = get(ss, 1, '') //TP, SL

        //add
        o.tdid = tdid
        o.kind = kind

        return o
    })
    // console.log('orders(add tdid, kind)', orders)
    // orders(add tdid, kind) [
    //   {
    //     orderId: 7605276920,
    //     symbol: 'ETHUSDT',
    //     status: 'NEW',
    //     clientOrderId: 'tdid-20251206194325-Zqaa49_SL',
    //     price: '0',
    //     avgPrice: '0',
    //     origQty: '0.007',
    //     executedQty: '0',
    //     cumQuote: '0.00000',
    //     timeInForce: 'GTC',
    //     type: 'STOP_MARKET',
    //     reduceOnly: true,
    //     closePosition: false,
    //     side: 'SELL',
    //     positionSide: 'BOTH',
    //     stopPrice: '3030.65',
    //     workingType: 'MARK_PRICE',
    //     priceProtect: false,
    //     origType: 'STOP_MARKET',
    //     priceMatch: 'NONE',
    //     selfTradePreventionMode: 'EXPIRE_MAKER',
    //     goodTillDate: 0,
    //     time: 1765021407346,
    //     updateTime: 1765021407346,
    //     tdid: 'tdid-20251206194325-Zqaa49',
    //     kind: 'SL'
    //   },
    //   {
    //     orderId: 7605276918,
    //     symbol: 'ETHUSDT',
    //     status: 'NEW',
    //     clientOrderId: 'tdid-20251206194325-Zqaa49_TP',
    //     price: '0',
    //     avgPrice: '0',
    //     origQty: '0.007',
    //     executedQty: '0',
    //     cumQuote: '0.00000',
    //     timeInForce: 'GTC',
    //     type: 'TAKE_PROFIT_MARKET',
    //     reduceOnly: true,
    //     closePosition: false,
    //     side: 'SELL',
    //     positionSide: 'BOTH',
    //     stopPrice: '3048.87',
    //     workingType: 'MARK_PRICE',
    //     priceProtect: false,
    //     origType: 'TAKE_PROFIT_MARKET',
    //     priceMatch: 'NONE',
    //     selfTradePreventionMode: 'EXPIRE_MAKER',
    //     goodTillDate: 0,
    //     time: 1765021407201,
    //     updateTime: 1765021407201,
    //     tdid: 'tdid-20251206194325-Zqaa49',
    //     kind: 'TP'
    //   }
    // ]

    //filter orders
    orders = filter(orders, (o) => {

        //b1
        let b1 = isestr(o.tdid)

        //b2
        let b2 = o.kind === 'TP' || o.kind === 'SL'

        //b
        let b = b1 && b2

        return b
    })
    // console.log('orders(filter kind)', orders)

    //gs
    let gs = groupBy(orders, 'tdid')
    // console.log('gs', gs)
    // gs {
    //   'tdid-20251206194325-Zqaa49': [
    //     {
    //       orderId: 7605276920,
    //       symbol: 'ETHUSDT',
    //       status: 'NEW',
    //       clientOrderId: 'tdid-20251206194325-Zqaa49_SL',
    //       price: '0',
    //       avgPrice: '0',
    //       origQty: '0.007',
    //       executedQty: '0',
    //       cumQuote: '0.00000',
    //       timeInForce: 'GTC',
    //       type: 'STOP_MARKET',
    //       reduceOnly: true,
    //       closePosition: false,
    //       side: 'SELL',
    //       positionSide: 'BOTH',
    //       stopPrice: '3030.65',
    //       workingType: 'MARK_PRICE',
    //       priceProtect: false,
    //       origType: 'STOP_MARKET',
    //       priceMatch: 'NONE',
    //       selfTradePreventionMode: 'EXPIRE_MAKER',
    //       goodTillDate: 0,
    //       time: 1765021407346,
    //       updateTime: 1765021407346,
    //       tdid: 'tdid-20251206194325-Zqaa49',
    //       kind: 'SL'
    //     },
    //     {
    //       orderId: 7605276918,
    //       symbol: 'ETHUSDT',
    //       status: 'NEW',
    //       clientOrderId: 'tdid-20251206194325-Zqaa49_TP',
    //       price: '0',
    //       avgPrice: '0',
    //       origQty: '0.007',
    //       executedQty: '0',
    //       cumQuote: '0.00000',
    //       timeInForce: 'GTC',
    //       type: 'TAKE_PROFIT_MARKET',
    //       reduceOnly: true,
    //       closePosition: false,
    //       side: 'SELL',
    //       positionSide: 'BOTH',
    //       stopPrice: '3048.87',
    //       workingType: 'MARK_PRICE',
    //       priceProtect: false,
    //       origType: 'TAKE_PROFIT_MARKET',
    //       priceMatch: 'NONE',
    //       selfTradePreventionMode: 'EXPIRE_MAKER',
    //       goodTillDate: 0,
    //       time: 1765021407201,
    //       updateTime: 1765021407201,
    //       tdid: 'tdid-20251206194325-Zqaa49',
    //       kind: 'TP'
    //     }
    //   ]
    // }

    //ordersCancel
    let ordersCancel = []
    each(gs, (os, tdid) => {

        //n
        let n = size(os)

        //check
        if (n === 2) {
            return true //跳出換下一個
        }
        if (n > 2) {
            throw new Error(`n[${n}] orders for tdid[${tdid}] > 2`)
        }

        //o, n=1
        let o = os[0]

        //push
        ordersCancel.push(o)

    })
    // console.log('ordersCancel', ordersCancel)
    // ordersCancel [
    //   {
    //     orderId: 7605276918,
    //     symbol: 'ETHUSDT',
    //     status: 'NEW',
    //     clientOrderId: 'tdid-20251206194325-Zqaa49_TP',
    //     price: '0',
    //     avgPrice: '0',
    //     origQty: '0.007',
    //     executedQty: '0',
    //     cumQuote: '0.00000',
    //     timeInForce: 'GTC',
    //     type: 'TAKE_PROFIT_MARKET',
    //     reduceOnly: true,
    //     closePosition: false,
    //     side: 'SELL',
    //     positionSide: 'BOTH',
    //     stopPrice: '3048.87',
    //     workingType: 'MARK_PRICE',
    //     priceProtect: false,
    //     origType: 'TAKE_PROFIT_MARKET',
    //     priceMatch: 'NONE',
    //     selfTradePreventionMode: 'EXPIRE_MAKER',
    //     goodTillDate: 0,
    //     time: 1765021407201,
    //     updateTime: 1765021407201,
    //     tdid: 'tdid-20251206194325-Zqaa49',
    //     kind: 'TP'
    //   }
    // ]

    //check
    if (size(ordersCancel) === 0) {
        return []
    }

    //ress
    let ress = []
    await pmSeries(ordersCancel, async(o) => {

        //isAlgo, algo單與普通單需呼叫不同的cancel API
        let isAlgo = get(o, 'isAlgo', false)

        //res
        let res = null
        if (isAlgo) {

            //algoId
            let algoId = get(o, 'algoId', '')

            await opBinaContractCancelAlgoOrder(st, algoId)
                .then((_res) => {
                    res = _res
                    // console.log('res', res)
                })
                .catch((err) => {
                    //不能報錯中斷, 須避免影響到後面也須取消下單
                    console.log(err)
                })

        }
        else {

            //orderId
            let orderId = get(o, 'orderId', '')

            await opBinaContractCancelOrder(st, orderId)
                .then((_res) => {
                    res = _res
                    // console.log('res', res)
                })
                .catch((err) => {
                    //不能報錯中斷, 須避免影響到後面也須取消下單
                    console.log(err)
                })

        }

        //check
        if (res) {

            //push
            ress.push(res)

        }

    })
    // console.log('ress', ress)
    // ress [
    //   {
    //     orderId: 7605276918,
    //     symbol: 'ETHUSDT',
    //     status: 'CANCELED',
    //     clientOrderId: 'tdid-20251206194325-Zqaa49_TP',
    //     price: '0.00',
    //     avgPrice: '0.00',
    //     origQty: '0.007',
    //     executedQty: '0.000',
    //     cumQty: '0.000',
    //     cumQuote: '0.00000',
    //     timeInForce: 'GTC',
    //     type: 'TAKE_PROFIT_MARKET',
    //     reduceOnly: true,
    //     closePosition: false,
    //     side: 'SELL',
    //     positionSide: 'BOTH',
    //     stopPrice: '3048.87',
    //     workingType: 'MARK_PRICE',
    //     priceProtect: false,
    //     origType: 'TAKE_PROFIT_MARKET',
    //     priceMatch: 'NONE',
    //     selfTradePreventionMode: 'EXPIRE_MAKER',
    //     goodTillDate: 0,
    //     updateTime: 1765024172313
    //   }
    // ]

    return ress
}


export default opBinaContractCancelResidualOrders
