import https from 'https'
import get from 'lodash-es/get.js'
import axios from 'axios'
import isbol from 'wsemi/src/isbol.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures'
import { Spot } from '@binance/spot'
import { DERIVATIVES_TRADING_USDS_FUTURES_REST_API_PROD_URL, SPOT_REST_API_PROD_URL } from '@binance/common'


//單一來源: 讀寫合一, 暫定值, 尖峰與正式端點未量, 實測後改此一處
let BINA_TIMEOUT_MS = 3000


//顯式傳給每個簽章請求; -1021之根因是舊時間戳不是視窗太小, 調大只會拉長查無之判定等待
let BINA_RECV_WINDOW_MS = 5000


//本機領先伺服器不超過1秒否則請求本身被拒
let BINA_CLOCK_MARGIN_MS = 1000


//retries:0由本套件重試並重新簽章; SDK之retries是總送出次數且沿用舊時間戳
let getClientConfig = (apiKey, apiSecret, basePath) => {
    return {
        apiKey,
        apiSecret,
        basePath,
        timeout: BINA_TIMEOUT_MS,
        //SDK預設keepAlive每請求新建Agent且不銷毀, 閒置連線會累積; 維持每請求新連線(卡住時換新連線有效, 閒置連線被對方關閉時多出未知結果), 回應後即關
        httpsAgent: new https.Agent({ keepAlive: false }),
        retries: 0,
        backoff: 0,
    }
}


//forceTest > forTestAll > binance.forTest, 皆非布林時預設測試(預設拒絕正式)
let getForTest = (st, opt) => {
    let forceTest = get(opt, 'forceTest', null)
    if (isbol(forceTest)) {
        return forceTest
    }
    let forTestAll = get(st, 'forTestAll', null)
    if (isbol(forTestAll)) {
        return forTestAll
    }
    let forTest = get(st, 'binance.forTest', null)
    if (isbol(forTest)) {
        return forTest
    }
    return true
}


//主機正規化: 小寫並去DNS尾隨點, 等價之正式主機才比對得到
let getHost = (url) => {
    return new URL(url).hostname.toLowerCase().replace(/\.+$/, '')
}


//fail-closed: SDK對空basePath回落正式端點, 全域baseURL會蓋過basePath, 皆須於任何請求之前擋下
let checkEndpoint = (st, forTest, keyBase, keyApi, isProdHost) => {

    if (!iseobj(st)) {
        throw new Error(`invalid st: must be a non-empty object`)
    }

    let basePath = get(st, `binance.${keyBase}`, '')
    if (!isestr(basePath)) {
        throw new Error(`invalid st.binance.${keyBase}: must be a non-empty string`)
    }

    let hostname = ''
    try {
        hostname = getHost(basePath)
    }
    catch (err) {
        throw new Error(`invalid st.binance.${keyBase}: must be a valid url`)
    }

    if (forTest && isProdHost(hostname)) {
        throw new Error(`invalid st.binance.${keyBase}: must not be the production endpoint when forTest is true`)
    }

    let apiKey = get(st, `binance.${keyApi}.key`, '')
    if (!isestr(apiKey)) {
        throw new Error(`invalid st.binance.${keyApi}.key: must be a non-empty string`)
    }
    let apiSecret = get(st, `binance.${keyApi}.secret`, '')
    if (!isestr(apiSecret)) {
        throw new Error(`invalid st.binance.${keyApi}.secret: must be a non-empty string`)
    }

    if (isestr(get(axios, 'defaults.baseURL', ''))) {
        throw new Error(`invalid axios.defaults.baseURL: must be empty, it overrides basePath`)
    }

    return { basePath, apiKey, apiSecret }
}


let isSameHost = (hostname, url) => {
    return hostname === getHost(url)
}


/**
 * 取幣安合約client, 全部合約操作之單一入口
 *
 * @param {Object} st 設定物件
 * @param {Object} [opt={}] opt.forceTest
 * @param {Object} [cfg={}] cfg.useSymbol預設true, 操作不使用st.symbol者給false
 * @returns {Object} { client, SYMBOL, forTest, basePath, recvWindow }
 */
let getBinaClient = (st, opt, cfg = {}) => {

    let forTest = getForTest(st, opt)
    let keyBase = forTest ? 'basePathTest' : 'basePath'
    let keyApi = forTest ? 'apiContractTest' : 'apiContract'
    let { basePath, apiKey, apiSecret } = checkEndpoint(st, forTest, keyBase, keyApi, (hostname) => {
        return isSameHost(hostname, DERIVATIVES_TRADING_USDS_FUTURES_REST_API_PROD_URL) || /^fapi\d*\.binance\.com$/.test(hostname)
    })

    let SYMBOL = get(st, 'symbol', '')
    if (get(cfg, 'useSymbol', true) !== false && !isestr(SYMBOL)) {
        throw new Error(`invalid st.symbol: must be a non-empty string`)
    }

    let configurationRestAPI = getClientConfig(apiKey, apiSecret, basePath)
    let client = new DerivativesTradingUsdsFutures({ configurationRestAPI })

    return {
        client,
        SYMBOL,
        forTest,
        basePath,
        recvWindow: BINA_RECV_WINDOW_MS,
    }
}


/**
 * 取幣安現貨client, 全部現貨操作之單一入口
 *
 * @param {Object} st 設定物件
 * @param {Object} [opt={}] opt.forceTest
 * @returns {Object} { client, SYMBOL, forTest, basePath, recvWindow }
 */
let getBinaSpotClient = (st, opt) => {

    let forTest = getForTest(st, opt)
    let keyBase = forTest ? 'basePathSpotTest' : 'basePathSpot'
    let keyApi = forTest ? 'apiSpotTest' : 'apiSpot'
    let { basePath, apiKey, apiSecret } = checkEndpoint(st, forTest, keyBase, keyApi, (hostname) => {
        return isSameHost(hostname, SPOT_REST_API_PROD_URL) || /^api\d*\.binance\.com$/.test(hostname)
    })

    let SYMBOL = get(st, 'symbol', '')
    if (!isestr(SYMBOL)) {
        throw new Error(`invalid st.symbol: must be a non-empty string`)
    }

    let configurationRestAPI = getClientConfig(apiKey, apiSecret, basePath)
    let client = new Spot({ configurationRestAPI })

    return {
        client,
        SYMBOL,
        forTest,
        basePath,
        recvWindow: BINA_RECV_WINDOW_MS,
    }
}


export {
    BINA_TIMEOUT_MS,
    BINA_RECV_WINDOW_MS,
    BINA_CLOCK_MARGIN_MS,
    getBinaSpotClient
}
export default getBinaClient
