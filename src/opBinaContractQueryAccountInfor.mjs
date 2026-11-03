import get from 'lodash-es/get.js'
import callBinaRead from './callBinaRead.mjs'
import { shapeObj } from './classifyBinaErr.mjs'
import getBinaClient from './getBinaClient.mjs'


/**
 * 查帳戶資訊, 讀取失敗拋BinaOpError(err.execState、err.binance.attempts)
 *
 * @param {Object} st 設定物件
 * @param {Object} [opt={}] forceTest, onTrace
 * @returns {Promise} resolve帳戶資訊
 */
let opBinaContractQueryAccountInfor = async(st, opt = {}) => {

    //client
    let { client, recvWindow } = getBinaClient(st, opt, { useSymbol: false })

    //acInfo
    let acInfo = await callBinaRead(() => client.restAPI.accountInformationV3({ recvWindow }), { name: 'account', shape: shapeObj, onTrace: get(opt, 'onTrace', null) })
    // console.log('acInfo', acInfo)
    // acInfo {
    //   totalInitialMargin: '0.00000000',
    //   totalMaintMargin: '0.00000000',
    //   totalWalletBalance: '1003.27085983',
    //   totalUnrealizedProfit: '0.00000000',
    //   totalMarginBalance: '1003.27085983',
    //   totalPositionInitialMargin: '0.00000000',
    //   totalOpenOrderInitialMargin: '0.00000000',
    //   totalCrossWalletBalance: '1003.27085983',
    //   totalCrossUnPnl: '0.00000000',
    //   availableBalance: '1003.27085983',
    //   maxWithdrawAmount: '1003.27085983',
    //   assets:[...],
    //   positions: [...],
    // }

    let r = acInfo

    return r
}


export default opBinaContractQueryAccountInfor
