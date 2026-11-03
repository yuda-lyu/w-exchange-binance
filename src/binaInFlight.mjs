//同程序在途防護之單一來源: 鍵為端點與實際之進場clientOrderId, Market與MarketEntry共用, 值為持有者之state
//狀態未知或部分成交後不釋放; 同程序內該ID須換新, 跨程序去重本套件做不到, 為呼叫端義務
let binaInFlight = new Map()


export default binaInFlight
