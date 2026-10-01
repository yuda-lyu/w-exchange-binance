import get from 'lodash-es/get.js'
import cdbl from 'wsemi/src/cdbl.mjs'
import dig from 'wsemi/src/dig.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import isp0int from 'wsemi/src/isp0int.mjs'


//數字轉為放大1e8之BigInt整數, 供整數運算避免浮點誤差(標記價API回傳至多8位小數)
let toBig = (v) => {
    return BigInt(Math.round(cdbl(v) * 1e8))
}


//notional非數字或<=0視為未設定
let hasNotional = (notional) => {
    return isnum(notional) && cdbl(notional) > 0
}


//檢查下單金額不低於最小名義價值notional, 未設定notional則不檢
//供opBinaContractMarket於任何API呼叫前先檢, calcContractQuantity內亦再檢
let checkUTradeNotional = (uTrade, notional) => {
    if (!hasNotional(notional)) {
        return
    }
    if (cdbl(uTrade) < cdbl(notional)) {
        throw new Error(`uTrade[${uTrade}] < notional[${notional}]`)
    }
}


//依下單金額與價格計算合約下單數量, 回傳小數位數為digContractQuantity之字串
//先向下取整至step(10^-digContractQuantity); 取整後名義(價格*數量)低於notional時只補1個step
//因uTrade>=notional, 補1個step後名義必>uTrade>=notional, 故數量至多比uTrade多1個step
//取整後不足quantityLow或為0則拋錯不補量, 避免金額遠不足1個step時被放大成1個step
//交易所之MIN_NOTIONAL對MARKET單以標記價計算, 不足回-4164; reduce-only單(止盈止損)不受限
let calcContractQuantity = (uTrade, price, digContractQuantity, opt = {}) => {

    //quantityLow, notional, 非數字則不檢
    let quantityLow = get(opt, 'quantityLow', '')
    let notional = get(opt, 'notional', '')

    //check
    if (!isnum(uTrade) || cdbl(uTrade) <= 0) {
        throw new Error(`invalid uTrade[${uTrade}]`)
    }
    if (!isnum(price) || cdbl(price) <= 0) {
        throw new Error(`invalid price[${price}]`)
    }
    if (!isp0int(digContractQuantity)) {
        throw new Error(`invalid digContractQuantity[${digContractQuantity}]`)
    }
    checkUTradeNotional(uTrade, notional)

    //整數運算: U=uTrade*1e8, P=price*1e8, D=10^digContractQuantity, 取整步數k=floor(U*D/P), BigInt除法即無條件捨去
    //須用**次方而非^: JS的^是XOR會把數量級錯位
    let U = toBig(uTrade)
    let P = toBig(price)
    let D = BigInt(10) ** BigInt(digContractQuantity)
    let k = U * D / P

    //toQuantity
    let toQuantity = (kk) => {
        return dig(Number(kk) / Number(D), digContractQuantity)
    }

    //quantity
    let quantity = toQuantity(k)

    //check quantityLow, 不足則拋錯不補量
    if (cdbl(quantity) < cdbl(quantityLow)) {
        throw new Error(`quantity[${quantity}] < quantityLow[${quantityLow}]`)
    }
    if (k <= BigInt(0)) {
        throw new Error(`quantity[${quantity}] <= 0`)
    }

    //補量, 名義<notional等價於P*k<N*D
    if (hasNotional(notional)) {
        let N = toBig(notional)
        if (P * k < N * D) {
            k = k + BigInt(1)
            quantity = toQuantity(k)
        }
        //補1個step後必滿足, 此處防呆避免送出必被拒之單
        if (P * k < N * D) {
            throw new Error(`price[${price}] * quantity[${quantity}] < notional[${notional}]`)
        }
    }

    return quantity
}


export { checkUTradeNotional }
export default calcContractQuantity
