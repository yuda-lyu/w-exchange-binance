import delay from 'wsemi/src/delay.mjs'
import getTrace from 'wsemi/src/getTrace.mjs'
import { classifyBinaErr, sendBina, toBinaOpError } from './classifyBinaErr.mjs'


//間隔沿用幣安文件503建議之量級; 每次重新呼叫fn即重新簽章, 無舊時間戳問題
let DELAYS_MS = [200, 400]


/**
 * 讀取類請求之統一入口, 只重試可重試者(無回應、5xx、幣安未知碼、本體不符), 其餘原樣失敗
 *
 * 觀察回調事件: attempt{name,n}, retry{name,n,delayMs,kind}, giveUp{name,attempts,kind}
 *
 * @param {Function} fn 回傳SDK Promise之函數, 每次重試重新呼叫
 * @param {Object} [opt={}] opt.name操作名, opt.shape本體形狀檢查函數, opt.onTrace觀察回調
 * @returns {Promise} resolve本體, reject BinaOpError(帶execState與binance.attempts)
 */
let callBinaRead = async (fn, opt = {}) => {

    let name = opt.name || 'read'
    let shape = opt.shape || null
    let trace = getTrace(opt)
    let total = DELAYS_MS.length + 1

    for (let n = 1; ; n++) {

        if (trace) {
            trace('attempt', { name, n })
        }

        try {
            return await sendBina(fn, shape)
        }
        catch (err) {
            let info = classifyBinaErr(err)
            if (!info.retryRead) {
                throw toBinaOpError(err, { name, attempts: n })
            }
            if (n >= total) {
                if (trace) {
                    trace('giveUp', { name, attempts: n, kind: info.kind })
                }
                throw toBinaOpError(err, { name, attempts: n })
            }
            let delayMs = DELAYS_MS[n - 1]
            if (trace) {
                trace('retry', { name, n, delayMs, kind: info.kind })
            }
            await delay(delayMs)
        }

    }

}


export default callBinaRead
