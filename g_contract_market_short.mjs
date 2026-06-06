import w from 'wsemi'
import { nowTpeStrp } from './src/ott.mjs'
import getSettings from './src/getSettings.mjs'
import webina from './src/WExchangeBinance.mjs'


//幣安合約市價做空

let st = getSettings()

let main = async() => {

    let tdid = `tdid-${nowTpeStrp()}-${w.genID(6)}`

    let uTrade = 22 //etc名義最小下單價值(notional)為20u, 最小下單量為0.001顆, 若etc當前價3000u, 最小下單量(0.001*3000=3u), 故主要由名義價值20u主導, 考慮止損5%後要滿足, 設定最每單基礎下單價22u
    console.log('uTrade', uTrade)

    let rTakeProfit = 0.004
    console.log('rTakeProfit', rTakeProfit)

    let rStopLoss = 0.002
    console.log('rStopLoss', rStopLoss)

    let res = await webina.opBinaContractMarket(st, 'short', tdid, uTrade, rTakeProfit, rStopLoss)
    console.log('res', res)
    // res {
    //   mode: 'short',
    //   symbol: 'ETHUSDT',
    //   quantity: '0.007',
    //   timeStart: '2025-12-07T20:53:07',
    //   priceStart: '3047.17000000',
    //   uTrade: '22.00',
    //   uTradeReal: '21.33',
    //   rTakeProfit: 0.004,
    //   priceTakeProfit: '3034.98',
    //   rStopLoss: 0.002,
    //   priceStopLoss: '3053.26',
    //   idTrade: 'tdid-20251207205304-LO94iV',
    //   idEntry: 7605753978,
    //   idTp: 7605753981,
    //   idSl: 7605753982,
    //   clientOrderIdEntry: 'tdid-20251207205304-LO94iV_ENTRY',
    //   clientOrderIdTp: 'tdid-20251207205304-LO94iV_TP',
    //   clientOrderIdSl: 'tdid-20251207205304-LO94iV_SL',
    //   resEntry: {
    //     orderId: 7605753978,
    //     symbol: 'ETHUSDT',
    //     status: 'NEW',
    //     clientOrderId: 'tdid-20251207205304-LO94iV_ENTRY',
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
    //     side: 'SELL',
    //     positionSide: 'SHORT',
    //     stopPrice: '0.00',
    //     workingType: 'CONTRACT_PRICE',
    //     priceProtect: false,
    //     origType: 'MARKET',
    //     priceMatch: 'NONE',
    //     selfTradePreventionMode: 'EXPIRE_MAKER',
    //     goodTillDate: 0,
    //     updateTime: 1765111987026
    //   },
    //   resTp: {
    //     orderId: 7605753981,
    //     symbol: 'ETHUSDT',
    //     status: 'NEW',
    //     clientOrderId: 'tdid-20251207205304-LO94iV_TP',
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
    //     side: 'BUY',
    //     positionSide: 'SHORT',
    //     stopPrice: '3034.98',
    //     workingType: 'MARK_PRICE',
    //     priceProtect: false,
    //     origType: 'TAKE_PROFIT_MARKET',
    //     priceMatch: 'NONE',
    //     selfTradePreventionMode: 'EXPIRE_MAKER',
    //     goodTillDate: 0,
    //     updateTime: 1765111987306
    //   },
    //   resSl: {
    //     orderId: 7605753982,
    //     symbol: 'ETHUSDT',
    //     status: 'NEW',
    //     clientOrderId: 'tdid-20251207205304-LO94iV_SL',
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
    //     side: 'BUY',
    //     positionSide: 'SHORT',
    //     stopPrice: '3053.26',
    //     workingType: 'MARK_PRICE',
    //     priceProtect: false,
    //     origType: 'STOP_MARKET',
    //     priceMatch: 'NONE',
    //     selfTradePreventionMode: 'EXPIRE_MAKER',
    //     goodTillDate: 0,
    //     updateTime: 1765111987587
    //   }
    // }

}
await main()
    .catch((err) => {
        console.log(err)
    })


//node g_contract_market_short.mjs
