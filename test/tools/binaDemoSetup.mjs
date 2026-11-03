import fs from 'fs'
import _ from 'lodash-es'
import w from 'wsemi'
import JSON5 from 'json5'
import { HOSTS_LIVE, bLive } from './binaNetGuard.mjs'
import webina from '../../src/WExchangeBinance.mjs'


//連外測試 setup: 預設不跑; 須明確設環境變數 BINA_LIVE_TEST=1. 只連測試端點(主機白名單, 另由binaNetGuard於網路層攔其他主機)
//記憶體內之設定抹除正式金鑰與正式端點, 全部 op 顯式 { forceTest: true }; settings.json 只透過程式讀取, 不印出
let opt = { forceTest: true }


let loadSt = () => {
    if (!bLive) {
        throw new Error('BINA_LIVE_TEST is not enabled')
    }
    let raw = JSON5.parse(fs.readFileSync('./settings.json', 'utf8'))
    let basePathTest = _.get(raw, 'binance.basePathTest', '')
    let host = ''
    try {
        host = new URL(basePathTest).hostname
    }
    catch (err) {
        throw new Error('invalid st.binance.basePathTest: must be a valid url')
    }
    if (!HOSTS_LIVE.includes(host)) {
        throw new Error('invalid st.binance.basePathTest: host is not in the test endpoint whitelist')
    }
    let key = _.get(raw, 'binance.apiContractTest.key', '')
    let secret = _.get(raw, 'binance.apiContractTest.secret', '')
    if (!w.isestr(key) || !w.isestr(secret) || key === _.get(raw, 'binance.apiContract.key', '')) {
        throw new Error('invalid st.binance.apiContractTest: must be set and differ from the production key')
    }
    return {
        ...raw,
        forTestAll: true,
        binance: {
            forTest: true,
            basePath: basePathTest,
            basePathTest,
            apiContract: { key: '', secret: '' },
            apiContractTest: { key, secret },
            apiSpot: { key: '', secret: '' },
        },
    }
}


//查該方向部位
let getPosAmt = async (st, positionSide) => {
    let poss = await webina.opBinaContractQueryPositionInfor(st, opt)
    let hit = _.find(poss, { positionSide })
    return w.cdbl(_.get(hit, 'positionAmt', 0))
}


//依tdid目標式清理: 撤該tdid之止損止盈; 依實際部位平掉(保護單可能已觸發, 按原量反向會開反向部位)
let cleanupByTdid = async (st, tdid, mode) => {
    if (!tdid) {
        return
    }
    let positionSide = mode === 'short' ? 'SHORT' : 'LONG'
    for (let clientAlgoId of [`${tdid}_SL`, `${tdid}_TP`]) {
        try {
            await webina.opBinaContractCancelAlgoOrder(st, { clientAlgoId }, opt)
        }
        catch (err) {
            //查不清者由resetTestAccount兜底
        }
    }
    let amt = await getPosAmt(st, positionSide)
    let qty = Math.abs(amt)
    if (qty > 0) {
        //LONG>0賣、SHORT<0買; 反向部位則反向處理
        let side = amt > 0 ? 'SELL' : 'BUY'
        await webina.opBinaContractMarketEntry(st, st.symbol, side, positionSide, qty, opt)
    }
}


//全清測試帳號 (危險: 撤所有單+平所有部位). 僅供手動重置測試帳號與連外測試結束前後確認.
let resetTestAccount = async (st) => {
    await webina.opBinaContractCancelAllOrder(st, opt)
    await webina.opBinaContractCancelAllAlgoOrder(st, opt)
    let poss = await webina.opBinaContractQueryPositionInfor(st, opt)
    for (let p of poss) {
        let amt = w.cdbl(_.get(p, 'positionAmt', 0))
        if (amt === 0) {
            continue
        }
        let positionSide = _.get(p, 'positionSide', 'BOTH')
        let side = amt > 0 ? 'SELL' : 'BUY'
        await webina.opBinaContractMarketEntry(st, st.symbol, side, positionSide, Math.abs(amt), opt)
    }
}


//帳戶現況: 開啟單數與非零部位
let getAccountState = async (st) => {
    let orders = await webina.opBinaContractListOrders(st, opt)
    let poss = await webina.opBinaContractQueryPositionInfor(st, opt)
    let positions = _.filter(poss, (p) => w.cdbl(_.get(p, 'positionAmt', 0)) !== 0)
    return { nOrders: orders.length, positions: _.map(positions, (p) => ({ positionSide: p.positionSide, positionAmt: p.positionAmt })) }
}


export {
    opt,
    bLive,
    loadSt,
    getPosAmt,
    cleanupByTdid,
    resetTestAccount,
    getAccountState
}
