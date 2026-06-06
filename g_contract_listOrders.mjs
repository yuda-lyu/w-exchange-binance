import getSettings from './src/getSettings.mjs'
import opBinaContractListOrders from './src/opBinaContractListOrders.mjs'


//幣安列舉未成交合約單

let st = getSettings()

let main = async() => {

    let res = await opBinaContractListOrders(st)
    console.log('res', res)
    // res [
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
    //     updateTime: 1765021407346
    //   },
    //   {
    //     orderId: 7605276918,
    //     symbol: 'ETHUSDT',
    //     status: 'NEW',
    //     clientOrderId: 'tdid-20251206194325-Zqaa49_TP',
    //     price: '0',
    //     avgPrice: '0',
    //     origQty: '0.007',
    //     goodTillDate: 0,
    //     time: 1765021407201,
    //     updateTime: 1765021407201
    //   }
    // ]

}
await main()
    .catch((err) => {
        console.log(err)
    })


//node g_contract_listOrders.mjs
