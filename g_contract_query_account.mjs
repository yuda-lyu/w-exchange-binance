import getSettings from './src/getSettings.mjs'
import webina from './src/WExchangeBinance.mjs'


//幣安查詢帳號資訊

let st = getSettings()

let main = async() => {

    let res = await webina.opBinaContractQueryAccountInfor(st)
    console.log('res', res)
    // res {
    //   totalInitialMargin: '0.00000000',
    //   totalMaintMargin: '0.00000000',
    //   totalWalletBalance: '5000.86840920',
    //   totalUnrealizedProfit: '0.00000000',
    //   totalMarginBalance: '5000.86840920',
    //   totalPositionInitialMargin: '0.00000000',
    //   totalOpenOrderInitialMargin: '0.00000000',
    //   totalCrossWalletBalance: '5000.86840920',
    //   totalCrossUnPnl: '0.00000000',
    //   availableBalance: '5000.86840920',
    //   maxWithdrawAmount: '5000.86840920',
    //   assets: [
    //     {
    //       asset: 'USDT',
    //       walletBalance: '5000.86840920',
    //       unrealizedProfit: '0.00000000',
    //       marginBalance: '5000.86840920',
    //       maintMargin: '0.00000000',
    //       initialMargin: '0.00000000',
    //       positionInitialMargin: '0.00000000',
    //       openOrderInitialMargin: '0.00000000',
    //       crossWalletBalance: '5000.86840920',
    //       crossUnPnl: '0.00000000',
    //       availableBalance: '5000.86840920',
    //       maxWithdrawAmount: '5000.86840920',
    //       updateTime: 1764596409036
    //     },
    //     ...
    //   ],
    //   positions: []
    // }

}
await main()
    .catch((err) => {
        console.log(err)
    })


//node g_contract_query_account.mjs
