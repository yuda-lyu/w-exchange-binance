import getSettings from './src/getSettings.mjs'
import opBinaContractCancelResidualOrders from './src/opBinaContractCancelResidualOrders.mjs'


//幣安成對合約單之取消遺留單向單

let st = getSettings()

let main = async() => {

    let call = async() => {
        let ress = await opBinaContractCancelResidualOrders(st)
        console.log('ress', ress)
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
    }

    let lock = false
    setInterval(() => {
        if (lock) {
            return
        }
        lock = true
        call()
            .catch((err) => {
                console.log(err)
            })
            .finally(() => {
                lock = false
            })
    }, 5000)

}
await main()
    .catch((err) => {
        console.log(err)
    })


//node g_contract_cancelResidualOrders.mjs
