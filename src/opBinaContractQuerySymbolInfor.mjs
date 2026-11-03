import find from 'lodash-es/find.js'
import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import callBinaRead from './callBinaRead.mjs'
import { shapeSymbols } from './classifyBinaErr.mjs'
import getBinaClient from './getBinaClient.mjs'


/**
 * 查商品資訊, 讀取失敗拋BinaOpError(err.execState、err.binance.attempts)
 *
 * @param {Object} st 設定物件
 * @param {String} SYMBOL 商品
 * @param {Object} [opt={}] forceTest, onTrace
 * @returns {Promise} resolve商品資訊
 */
let opBinaContractQuerySymbolInfor = async(st, SYMBOL, opt = {}) => {

    //check
    if (!isestr(SYMBOL)) {
        throw new Error(`invalid SYMBOL: must be a non-empty string`)
    }

    //client
    let { client } = getBinaClient(st, opt, { useSymbol: false })

    //exInfo
    let exInfo = await callBinaRead(() => client.restAPI.exchangeInformation(), { name: 'exchangeInfo', shape: shapeSymbols, onTrace: get(opt, 'onTrace', null) })
    // console.log('exInfo', keys(exInfo))
    // exInfo [
    //   'timezone',
    //   'serverTime',
    //   'futuresType',
    //   'rateLimits',
    //   'exchangeFilters',
    //   'assets',
    //   'symbols'
    // ]

    //symbols
    let symbols = get(exInfo, 'symbols', [])
    // symbols [
    //   'BTCUSDT',   'ETHUSDT',   'BCHUSDT',      'XRPUSDT',   'LTCUSDT',
    //   'TRXUSDT',   'ETCUSDT',   'LINKUSDT',     'XLMUSDT',   'ADAUSDT',
    //    ...
    // ]

    //symb
    let symb = find(symbols, { symbol: SYMBOL })
    if (!iseobj(symb)) {
        throw new Error(`invalid SYMBOL: must be a listed symbol`)
    }
    // console.log('symb', symb)
    // symb {
    //   symbol: 'ETHUSDT',
    //   pair: 'ETHUSDT',
    //   contractType: 'PERPETUAL',
    //   deliveryDate: 4133404800000,
    //   onboardDate: 1569398400000,
    //   status: 'TRADING',
    //   maintMarginPercent: '2.5000',
    //   requiredMarginPercent: '5.0000',
    //   baseAsset: 'ETH',
    //   quoteAsset: 'USDT',
    //   marginAsset: 'USDT',
    //   pricePrecision: 2,
    //   quantityPrecision: 3,
    //   baseAssetPrecision: 8,
    //   quotePrecision: 8,
    //   underlyingType: 'COIN',
    //   underlyingSubType: [],
    //   triggerProtect: '0.0500',
    //   liquidationFee: '0.020000',
    //   marketTakeBound: '0.10',
    //   maxMoveOrderLimit: 10000,
    //   filters: [
    //     {
    //       filterType: 'PRICE_FILTER',
    //       minPrice: '39.86',
    //       maxPrice: '306177',
    //       tickSize: '0.01'
    //     },
    //     {
    //       stepSize: '0.001',
    //       maxQty: '10000',
    //       filterType: 'LOT_SIZE',
    //       minQty: '0.001'
    //     },
    //     {
    //       filterType: 'MARKET_LOT_SIZE',
    //       stepSize: '0.001',
    //       minQty: '0.001',
    //       maxQty: '10000'
    //     },
    //     { limit: 10000, filterType: 'MAX_NUM_ORDERS' },
    //     { filterType: 'MAX_NUM_ALGO_ORDERS', limit: 10 },
    //     { filterType: 'MIN_NOTIONAL', notional: '20' },
    //     {
    //       filterType: 'PERCENT_PRICE',
    //       multiplierUp: '1.0500',
    //       multiplierDecimal: '4',
    //       multiplierDown: '0.9500'
    //     },
    //     {
    //       filterType: 'POSITION_RISK_CONTROL',
    //       positionControlSide: 'NONE'
    //     }
    //   ],
    //   orderTypes: [
    //     'LIMIT',
    //     'MARKET',
    //     'STOP',
    //     'STOP_MARKET',
    //     'TAKE_PROFIT',
    //     'TAKE_PROFIT_MARKET',
    //     'TRAILING_STOP_MARKET'
    //   ],
    //   timeInForce: [ 'GTC', 'IOC', 'FOK', 'GTX', 'GTD' ],
    //   permissionSets: [ 'GRID', 'COPY' ]
    // }
    //註: 上列含MAX_NUM_ALGO_ORDERS, 為2025-12-29前之輸出; 2025-12-29起exchangeInfo已移除MAX_NUM_ALGO_ORDERS, 條件單上限改為全帳號跨商品共200; 2026-10-01實取主網ETHUSDT之MAX_NUM_ORDERS為200、MIN_NOTIONAL為20

    let r = symb

    return r
}


export default opBinaContractQuerySymbolInfor
