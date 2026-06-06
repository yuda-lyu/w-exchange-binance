import getSettings from './src/getSettings.mjs'
import opBinaSpotLimit from './src/opBinaSpotLimit.mjs'


//幣安現貨限價購買

let st = getSettings()

let main = async() => {

    let price = 90000 //測試用, 低於限價避免真的買到
    console.log('price', price)

    let uTrade = 6 //最小交易金額為5u, 給稍大6u, 若止損超過17%才會小於5u
    console.log('uTrade', uTrade)

    let rTakeProfit = 0.02
    console.log('rTakeProfit', rTakeProfit)

    let rStopLoss = 0.01
    console.log('rStopLoss', rStopLoss)

    let res = await opBinaSpotLimit(st, price, uTrade, rTakeProfit, rStopLoss)
    console.log('res', res)
    // res {
    //   id: 17236102110,
    //   time: '2025-11-30T21:47:33',
    //   symbol: 'ETHUSDT',
    //   quantity: '0.00006000',
    //   timeStart: '2025-11-30T21:47:33',
    //   priceStart: '90000.00',
    //   uTrade: '6.00',
    //   rTakeProfit: 0.02,
    //   priceTakeProfit: '91800.00',
    //   rStopLoss: 0.01,
    //   priceStopLoss: '89100.00',
    //   res: {
    //     orderListId: 17236102110,
    //     contingencyType: 'OTO',
    //     listStatusType: 'EXEC_STARTED',
    //     listOrderStatus: 'EXECUTING',
    //     listClientOrderId: 'jU9H9FOm1RWUxqCg0MH9EG',
    //     transactionTime: 1764510453320,
    //     symbol: 'ETHUSDT',
    //     orders: [ [Object], [Object], [Object] ],
    //     orderReports: [ [Object], [Object], [Object] ]
    //   }
    // }

}
await main()
    .catch((err) => {
        console.log(err)
    })


//node g_spot_limit.mjs
