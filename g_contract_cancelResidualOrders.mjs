import getSettings from './src/getSettings.mjs'
import webina from './src/WExchangeBinance.mjs'


//幣安成對合約單之取消遺留單向單

let st = getSettings()

let main = async() => {

    let call = async() => {
        let r = await webina.opBinaContractCancelResidualOrders(st)
        console.log('r', r)
        //依部位符號、腿量、腿齡與對腳判定, 判不了不撤且回報; 須定期呼叫
        // r {
        //   cancelled: [
        //     { o: { algoId: 1000000097812785, clientAlgoId: 'tdid-20251206194325-Zqaa49_TP', ... }, state: 'CANCELED', res: { ... } }
        //   ],
        //   closedOtherwise: [], //撤單時已成交或已觸發者, { o, state, res }
        //   skipped: [], //{ o, reason }, reason: tooNew, positionChanging, reversedPosition, anomalous, oversized, partnerUnconfirmed, partnerStatus:xxx
        //   failed: [], //{ o, execState, code }
        //   unprotected: [], //撤單後部位不為0而0筆腿, { positionSide, amt }
        //   underProtected: [], //撤單後有腿而某kind合計少於部位, { positionSide, kind, legQty, amt }
        // }
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
