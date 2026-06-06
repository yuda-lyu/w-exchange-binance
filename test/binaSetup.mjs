import _ from 'lodash-es'
import w from 'wsemi'
import getSettings from '../src/getSettings.mjs'
import opBinaContractCancelAlgoOrder from '../src/opBinaContractCancelAlgoOrder.mjs'
import opBinaContractCancelAllOrder from '../src/opBinaContractCancelAllOrder.mjs'
import opBinaContractCancelAllAlgoOrder from '../src/opBinaContractCancelAllAlgoOrder.mjs'
import opBinaContractQueryPositionInfor from '../src/opBinaContractQueryPositionInfor.mjs'
import opBinaContractMarketEntry from '../src/opBinaContractMarketEntry.mjs'


//測試 setup: helper 全部走 op 函式 + 顯式 { forceTest: true }, 不再自建 SDK client.
//測試金鑰/端點皆由各 op 內部從 settings.json (binance.apiContractTest + binance.basePathTest) 解析,
//此檔不重複處理. 不依賴 settings.json 的 forTest/binance.forTest 是測試還是正式, forceTest 直接覆寫.
let st = getSettings()
let SYMBOL = _.get(st, 'symbol', '')


//目標式清理: 只清「本次測試建立的這筆」TP/SL + 平掉它加進去的部位, 不動帳號其他單
//r 為 opBinaContractMarket 的回傳 (含 mode/quantity/algoIdTp/algoIdSl)
let cleanupByResult = async (r) => {
    if (!r) {
        return
    }

    //撤該tdid的TP/SL algo單 (走 op 函式, 顯式 forceTest:true)
    for (let algoId of [r.algoIdTp, r.algoIdSl]) {
        if (!algoId) {
            continue
        }
        try {
            await opBinaContractCancelAlgoOrder(st, Number(algoId), { forceTest: true })
        }
        catch (e) {
            //已成交/已撤則略過
        }
    }

    //平掉本次進場加進去的部位量(反向市價, 同positionSide). hedge mode下平倉=反向同向位
    try {
        let qty = w.cdbl(r.quantity)
        if (qty > 0) {
            let side = r.mode === 'long' ? 'SELL' : 'BUY'
            let positionSide = r.mode === 'long' ? 'LONG' : 'SHORT'
            await opBinaContractMarketEntry(st, SYMBOL, side, positionSide, qty, { forceTest: true })
        }
    }
    catch (e) {
        //平倉失敗不中斷(避免影響其他測試清理)
    }
}


//全清測試帳號 (危險: 撤所有單+平所有部位). 僅供手動重置測試帳號用, 測試流程不自動呼叫.
//全部走 op 函式 (顯式 forceTest:true), 不會誤動正式帳號.
let resetTestAccount = async () => {

    //撤所有普通單
    try {
        await opBinaContractCancelAllOrder(st, { forceTest: true })
    }
    catch (e) {
        console.log('cancelAllOpenOrders', String(e))
    }

    //撤所有algo單
    try {
        await opBinaContractCancelAllAlgoOrder(st, { forceTest: true })
    }
    catch (e) {
        console.log('cancelAllAlgoOpenOrders', String(e))
    }

    //平所有部位(LONG/SHORT各自反向市價)
    try {
        let poss = await opBinaContractQueryPositionInfor(st, { forceTest: true })
        for (let p of (poss || [])) {
            let amt = w.cdbl(_.get(p, 'positionAmt', 0))
            if (amt === 0) {
                continue
            }
            let positionSide = _.get(p, 'positionSide', 'BOTH')
            let side = amt > 0 ? 'SELL' : 'BUY'
            await opBinaContractMarketEntry(st, SYMBOL, side, positionSide, Math.abs(amt), { forceTest: true })
        }
    }
    catch (e) {
        console.log('closeAllPositions', String(e))
    }
}


export {
    SYMBOL,
    cleanupByResult,
    resetTestAccount,
}
