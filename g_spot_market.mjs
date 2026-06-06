import getSettings from './src/getSettings.mjs'
import opBinaSpotMarket from './src/opBinaSpotMarket.mjs'


//幣安現貨市價購買

let st = getSettings()

let main = async() => {

    let uTrade = 6 //最小交易金額為5u, 給稍大6u, 若止損超過17%才會小於5u
    console.log('uTrade', uTrade)

    let rTakeProfit = 0.02
    console.log('rTakeProfit', rTakeProfit)

    let rStopLoss = 0.01
    console.log('rStopLoss', rStopLoss)

    let res = await opBinaSpotMarket(st, uTrade, rTakeProfit, rStopLoss)
    console.log('res', res)
    // res {
    //   id: 17235633322,
    //   symbol: 'ETHUSDT',
    //   quantity: '0.00006000',
    //   timeStart: '2025-11-30T21:31:33',
    //   priceStart: 91782.37,
    //   uTrade: '6.00',
    //   uTradeReal: 5.5069422,
    //   rTakeProfit: 0.02,
    //   priceTakeProfit: '93618.02',
    //   rStopLoss: 0.01,
    //   priceStopLoss: '90864.55',
    //   resBuy: {
    //     symbol: 'ETHUSDT',
    //     orderId: 53086303200,
    //     orderListId: -1,
    //     clientOrderId: 'vyGTQhuOX3tYOG16FQxuad',
    //     transactTime: 1764509493653,
    //     price: '0.00000000',
    //     origQty: '0.00006000',
    //     executedQty: '0.00006000',
    //     origQuoteOrderQty: '6.00000000',
    //     cummulativeQuoteQty: '5.50694220',
    //     status: 'FILLED',
    //     timeInForce: 'GTC',
    //     type: 'MARKET',
    //     side: 'BUY',
    //     workingTime: 1764509493653,
    //     fills: [ [Object] ],
    //     selfTradePreventionMode: 'EXPIRE_MAKER'
    //   },
    //   resOco: {
    //     orderListId: 17235633322,
    //     contingencyType: 'OCO',
    //     listStatusType: 'EXEC_STARTED',
    //     listOrderStatus: 'EXECUTING',
    //     listClientOrderId: '1fgIGZXTo4USrPLGFug0XV',
    //     transactionTime: 1764509493718,
    //     symbol: 'ETHUSDT',
    //     orders: [ [Object], [Object] ],
    //     orderReports: [ [Object], [Object] ]
    //   }
    // }

}
await main()
    .catch((err) => {
        console.log(err)
    })


//node g_spot_market.mjs
