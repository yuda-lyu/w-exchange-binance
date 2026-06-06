import getSettings from './src/getSettings.mjs'
import webina from './src/WExchangeBinance.mjs'


//幣安合約單偵測成對交易單取消

let st = getSettings()

let main = async() => {

    let orderId = '10630546603'

    let res = await webina.opBinaContractCancelOrder(st, orderId)
    console.log('res', res)
    // res {
    //   orderId: 9253619056,
    //   symbol: 'ETHUSDT',
    //   status: 'CANCELED',
    //   clientOrderId: 'KgUGGEwT2WVt5appBQu7qj',
    //   price: '1396.95',
    //   origQty: '0.020',
    //   executedQty: '0.000',
    //   cumQty: '0.000',
    //   timeInForce: 'GTC',
    //   type: 'LIMIT',
    //   reduceOnly: false,
    //   closePosition: false,
    //   side: 'BUY',
    //   positionSide: 'LONG',
    //   stopPrice: '0.00',
    //   workingType: 'CONTRACT_PRICE',
    //   priceProtect: false,
    //   origType: 'LIMIT',
    //   priceMatch: 'NONE',
    //   selfTradePreventionMode: 'EXPIRE_MAKER',
    //   goodTillDate: 0,
    //   updateTime: 1780759499844
    // }

}
await main()
    .catch((err) => {
        console.log(err)
    })


//node g_contract_cancelOrder.mjs
