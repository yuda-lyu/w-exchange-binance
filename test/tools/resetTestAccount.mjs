import { bLive, getAccountState, loadSt, resetTestAccount } from './binaDemoSetup.mjs'


//手動重置測試帳號: 撤所有單(普通+algo) + 平所有部位.
//用途: 測試機 throwaway 部位佔滿 algo 額度時, 跑此清空, 讓下單生命週期測試有額度可放 TP/SL.
//⚠ 一律針對測試帳號: 須設 BINA_LIVE_TEST=1, 主機白名單檢查, 記憶體內抹除正式金鑰.
let main = async () => {
    if (!bLive) {
        console.log('須設環境變數 BINA_LIVE_TEST=1')
        return
    }
    let st = loadSt()
    await resetTestAccount(st)
    console.log('完成', await getAccountState(st))
}
await main()
    .catch((err) => {
        console.log('ERR', err.message)
    })


//BINA_LIVE_TEST=1 node test/tools/resetTestAccount.mjs
