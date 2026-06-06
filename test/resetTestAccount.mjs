import { resetTestAccount, SYMBOL } from './binaSetup.mjs'


//手動重置測試帳號: 撤所有單(普通+algo) + 平所有部位.
//用途: 測試機 throwaway 部位佔滿 algo 額度時, 跑此清空, 讓下單生命週期測試有額度可放 TP/SL.
//⚠ 一律針對測試帳號: binaSetup.resetTestAccount 內部全走 op 函式 + 顯式 forceTest:true, 不會誤動正式帳號.
let main = async () => {
    console.log(`重置測試帳號 symbol=${SYMBOL} (apiContractTest @ basePathTest) ...`)
    await resetTestAccount()
    console.log('完成: 已撤所有單 + 平所有部位')
}
await main()
    .catch((err) => {
        console.log('ERR', err)
    })


//node test/resetTestAccount.mjs
