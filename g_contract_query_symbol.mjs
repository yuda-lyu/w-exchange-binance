import getSettings from './src/getSettings.mjs'
import opBinaContractQuerySymbolInfor from './src/opBinaContractQuerySymbolInfor.mjs'


//幣安查詢幣種資訊

let st = getSettings()

let main = async() => {

    let res = await opBinaContractQuerySymbolInfor(st, 'ETHUSDT')
    console.log('res', res)
    // res {
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

}
await main()
    .catch((err) => {
        console.log(err)
    })


//node g_contract_query_symbol.mjs
