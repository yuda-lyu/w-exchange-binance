import opBinaSpotMarket from './opBinaSpotMarket.mjs'
import opBinaSpotLimit from './opBinaSpotLimit.mjs'
import opBinaContractMarket from './opBinaContractMarket.mjs'
import opBinaContractMarketEntry from './opBinaContractMarketEntry.mjs'
import opBinaContractQuerySymbolInfor from './opBinaContractQuerySymbolInfor.mjs'
import opBinaContractQueryAccountInfor from './opBinaContractQueryAccountInfor.mjs'
import opBinaContractQueryPositionInfor from './opBinaContractQueryPositionInfor.mjs'
import opBinaContractQueryOrderInfo from './opBinaContractQueryOrderInfo.mjs'
import opBinaContractListOrders from './opBinaContractListOrders.mjs'
import opBinaContractListOrdersHistory from './opBinaContractListOrdersHistory.mjs'
import opBinaContractListTradesFilled from './opBinaContractListTradesFilled.mjs'
import opBinaContractCancelOrder from './opBinaContractCancelOrder.mjs'
import opBinaContractCancelAlgoOrder from './opBinaContractCancelAlgoOrder.mjs'
import opBinaContractCancelAllOrder from './opBinaContractCancelAllOrder.mjs'
import opBinaContractCancelAllAlgoOrder from './opBinaContractCancelAllAlgoOrder.mjs'
import opBinaContractCancelResidualOrders from './opBinaContractCancelResidualOrders.mjs'


let WExchangeBinance = {

    //現貨
    opBinaSpotMarket,
    opBinaSpotLimit,

    //合約下單
    opBinaContractMarket,
    opBinaContractMarketEntry,

    //合約查詢
    opBinaContractQuerySymbolInfor,
    opBinaContractQueryAccountInfor,
    opBinaContractQueryPositionInfor,
    opBinaContractQueryOrderInfo,

    //合約列舉
    opBinaContractListOrders,
    opBinaContractListOrdersHistory,
    opBinaContractListTradesFilled,

    //合約取消
    opBinaContractCancelOrder,
    opBinaContractCancelAlgoOrder,
    opBinaContractCancelAllOrder,
    opBinaContractCancelAllAlgoOrder,
    opBinaContractCancelResidualOrders,

}


export default WExchangeBinance
