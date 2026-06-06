import find from 'lodash-es/find.js'
import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import isbol from 'wsemi/src/isbol.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures'


let opBinaContractQuerySymbolInfor = async(st, SYMBOL, opt = {}) => {

    //params
    let forceTest = get(opt, 'forceTest', null)
    let forTestAll = get(st, 'forTestAll', null)
    let forTest = get(st, 'binance.forTest', null)
    if (isbol(forceTest)) {
        forTest = forceTest
    }
    else if (isbol(forTestAll)) {
        forTest = forTestAll
    }
    else if (!isbol(forTest)) {
        forTest = true
    }
    let keyApiContract = 'apiContract'
    if (forTest) {
        keyApiContract = 'apiContractTest'
    }
    //basePath 由 settings 決定: forTest=true 用 binance.basePathTest (測試端點); forTest=false 用 binance.basePath (正式端點)
    let basePath = forTest ? get(st, 'binance.basePathTest', '') : get(st, 'binance.basePath', '')
    let API_KEY = get(st, `binance.${keyApiContract}.key`, '')
    let API_SECRET = get(st, `binance.${keyApiContract}.secret`, '')
    // console.log('API_KEY', API_KEY)
    // console.log('API_SECRET', API_SECRET)

    //client
    let configurationRestAPI = {
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        basePath,
    }
    let client = new DerivativesTradingUsdsFutures({ configurationRestAPI })

    //exInfo
    let exInfom = await client.restAPI.exchangeInformation()
    let exInfo = await exInfom.data()
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
    console.log('symbols', map(symbols, 'symbol'))
    // symbols [
    //   'BTCUSDT',   'ETHUSDT',   'BCHUSDT',      'XRPUSDT',   'LTCUSDT',
    //   'TRXUSDT',   'ETCUSDT',   'LINKUSDT',     'XLMUSDT',   'ADAUSDT',
    //    ...
    // ]

    //symb
    let symb = find(symbols, { symbol: SYMBOL })
    if (!iseobj(symb)) {
        throw new Error(`invalid symb for ${SYMBOL}`)
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

    let r = symb

    return r
}


export default opBinaContractQuerySymbolInfor
