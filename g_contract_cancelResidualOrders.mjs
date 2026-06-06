import getSettings from './src/getSettings.mjs'
import webina from './src/WExchangeBinance.mjs'


//幣安成對合約單之取消遺留單向單

let st = getSettings()

let main = async() => {

    let call = async() => {
        let ress = await webina.opBinaContractCancelResidualOrders(st)
        console.log('ress', ress)
        // ress [
        //   {
        //     //algo 孤兒單(TP/SL)由 cancelAlgoOrder 撤, 回精簡回應:
        //     algoId: 1000000097812785,
        //     clientAlgoId: 'tdid-20251206194325-Zqaa49_TP',
        //     code: '200',
        //     msg: 'success'
        //   }
        //   //註: 若孤兒為普通單(由 cancelOrder 撤), 該元素為完整訂單物件
        //   //    (status:'CANCELED', 結構同 g_contract_cancelOrder.mjs 的 res)
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
