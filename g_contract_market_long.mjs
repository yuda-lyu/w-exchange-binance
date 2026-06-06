import w from 'wsemi'
import { nowTpeStrp } from './src/ott.mjs'
import getSettings from './src/getSettings.mjs'
import webina from './src/WExchangeBinance.mjs'


//幣安合約市價做多

let st = getSettings()

let main = async() => {

    let tdid = `tdid-${nowTpeStrp()}-${w.genID(6)}`

    let uTrade = 22 //etc名義最小下單價值(notional)為20u, 最小下單量為0.001顆, 若etc當前價3000u, 最小下單量(0.001*3000=3u), 故主要由名義價值20u主導, 考慮止損5%後要滿足, 設定最每單基礎下單價22u
    console.log('uTrade', uTrade)

    let rTakeProfit = 0.004
    console.log('rTakeProfit', rTakeProfit)

    let rStopLoss = 0.002
    console.log('rStopLoss', rStopLoss)

    let res = await webina.opBinaContractMarket(st, 'long', tdid, uTrade, rTakeProfit, rStopLoss)
    console.log('res', res)
    // res {
    //   mode: 'long',
    //   symbol: 'ETHUSDT',
    //   quantity: '0.007',
    //   timeStart: '2025-12-07T20:50:42',
    //   priceStart: '3047.31965116',
    //   uTrade: '22.00',
    //   uTradeReal: '21.33',
    //   rTakeProfit: 0.004,
    //   priceTakeProfit: '3059.51',
    //   rStopLoss: 0.002,
    //   priceStopLoss: '3041.23',
    //   idTrade: 'tdid-20251207205039-YbL7MN',
    //   idEntry: 7605753097,
    //   idTp: 7605753100,
    //   idSl: 7605753102,
    //   clientOrderIdEntry: 'tdid-20251207205039-YbL7MN_ENTRY',
    //   clientOrderIdTp: 'tdid-20251207205039-YbL7MN_TP',
    //   clientOrderIdSl: 'tdid-20251207205039-YbL7MN_SL',
    //   resEntry: {
    //     orderId: 7605753097,
    //     symbol: 'ETHUSDT',
    //     status: 'NEW',
    //     clientOrderId: 'tdid-20251207205039-YbL7MN_ENTRY',
    //     price: '0.00',
    //     avgPrice: '0.00',
    //     origQty: '0.007',
    //     executedQty: '0.000',
    //     cumQty: '0.000',
    //     cumQuote: '0.00000',
    //     timeInForce: 'GTC',
    //     type: 'MARKET',
    //     reduceOnly: false,
    //     closePosition: false,
    //     side: 'BUY',
    //     positionSide: 'LONG',
    //     stopPrice: '0.00',
    //     workingType: 'CONTRACT_PRICE',
    //     priceProtect: false,
    //     origType: 'MARKET',
    //     priceMatch: 'NONE',
    //     selfTradePreventionMode: 'EXPIRE_MAKER',
    //     goodTillDate: 0,
    //     updateTime: 1765111842005
    //   },
    //   resTp: {
    //     orderId: 7605753100,
    //     symbol: 'ETHUSDT',
    //     status: 'NEW',
    //     clientOrderId: 'tdid-20251207205039-YbL7MN_TP',
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
    //     positionSide: 'LONG',
    //     stopPrice: '3059.51',
    //     workingType: 'MARK_PRICE',
    //     priceProtect: false,
    //     origType: 'TAKE_PROFIT_MARKET',
    //     priceMatch: 'NONE',
    //     selfTradePreventionMode: 'EXPIRE_MAKER',
    //     goodTillDate: 0,
    //     updateTime: 1765111842380
    //   },
    //   resSl: {
    //     orderId: 7605753102,
    //     symbol: 'ETHUSDT',
    //     status: 'NEW',
    //     clientOrderId: 'tdid-20251207205039-YbL7MN_SL',
    //     price: '0.00',
    //     avgPrice: '0.00',
    //     origQty: '0.007',
    //     executedQty: '0.000',
    //     cumQty: '0.000',
    //     cumQuote: '0.00000',
    //     timeInForce: 'GTC',
    //     type: 'STOP_MARKET',
    //     reduceOnly: true,
    //     closePosition: false,
    //     side: 'SELL',
    //     positionSide: 'LONG',
    //     stopPrice: '3041.23',
    //     workingType: 'MARK_PRICE',
    //     priceProtect: false,
    //     origType: 'STOP_MARKET',
    //     priceMatch: 'NONE',
    //     selfTradePreventionMode: 'EXPIRE_MAKER',
    //     goodTillDate: 0,
    //     updateTime: 1765111842723
    //   }
    // }

}
await main()
    .catch((err) => {
        console.log(err)
    })


//node g_contract_market_long.mjs
