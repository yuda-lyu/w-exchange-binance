import assert from 'assert'
import ott from '../src/ott.mjs'
import webina from '../src/WExchangeBinance.mjs'
import calcContractQuantity, { checkUTradeNotional } from '../src/calcContractQuantity.mjs'


//合約下單數量計算(不連網)
//規則: 向下取整至step; 取整後名義(價格*數量)<notional時只補1個step; 取整後不足quantityLow或為0拋錯不補量; uTrade<notional拋錯
//交易所依據: ETHUSDT之MIN_NOTIONAL為20、stepSize為0.001, MARKET單以標記價計算名義, 不足回-4164
//價格以「分」為整數單位掃描, 名義以整數比較: 價格(分)*步數>=notional*100*1000, 不經浮點
describe('合約下單數量計算 calcContractQuantity (不連網)', function() {
    this.timeout(180000)

    let C0 = 100000 //1000.00
    let C1 = 600000 //6000.00
    let opt = { quantityLow: 0.001, notional: 20 }

    //精確取整步數 floor(uTrade*1000/price), uTrade與price皆以分為單位之整數
    let kFloorExact = (uCents, c) => {
        return Number((BigInt(uCents) * BigInt(1000)) / BigInt(c))
    }

    //3位小數之數量字串轉步數, 不經浮點
    let toSteps = (q) => {
        return Number(q.replace('.', ''))
    }

    it('全掃1000.00~6000.00: 名義足夠者數量同取整、不足者只補1個step、名義皆>=20、格式恰3位小數', () => {
        for (let c = C0; c <= C1; c++) {
            let q = calcContractQuantity('22.00', c / 100, 3, opt)

            //數量為恰有3位小數之字串, 無浮點殘值(stepSize 0.001)
            if (!/^\d+\.\d{3}$/.test(q)) {
                assert.fail(`格式 price=${c / 100} quantity=${q}`)
            }

            let k = toSteps(q)
            let kOld = kFloorExact(2200, c)
            if (c * kOld >= 2000000) {
                //取整後名義>=notional者, 數量與向下取整相同(原本會成交之單不變)
                if (k !== kOld) {
                    assert.fail(`不變 price=${c / 100} k=${k} kOld=${kOld}`)
                }
            }
            else {
                //取整後名義<notional者, 只補1個step
                if (k !== kOld + 1) {
                    assert.fail(`補量 price=${c / 100} k=${k} kOld=${kOld}`)
                }
            }

            //名義>=notional(交易所MIN_NOTIONAL)
            if (c * k < 2000000) {
                assert.fail(`名義 price=${c / 100} k=${k}`)
            }
        }
    })

    it('報告所列落帶價位補1個step後名義>=20; 名義足夠之價位維持原數量', () => {
        //取整後名義<20之價位, 補1個step
        let cases = [
            [2210, '0.010'], //取整0.009名義19.89
            [2450, '0.009'], //取整0.008名義19.60
            [2800, '0.008'], //取整0.007名義19.60
            [3200, '0.007'], //取整0.006名義19.20
            [3800, '0.006'], //取整0.005名義19.00
            [4500, '0.005'], //取整0.004名義18.00
            [4900, '0.005'], //取整0.004名義19.60
        ]
        for (let [p, qe] of cases) {
            assert.strictEqual(calcContractQuantity('22.00', p, 3, opt), qe, `price=${p}`)
        }

        //取整後名義>=20之價位, 維持原數量(0.007名義21.26); 價格為API字串(含尾零)時同數值輸入
        assert.strictEqual(calcContractQuantity('22.00', 3036.72, 3, opt), '0.007')
        assert.strictEqual(calcContractQuantity('22.00', '3036.72000000', 3, opt), '0.007')
    })

    it('整數運算: 結果等於精確取整, 不受浮點誤差影響', () => {
        //33.33/1333.20*1000恰為25, 浮點計算會得24.999...而少1個step
        assert.strictEqual(calcContractQuantity('33.33', 1333.20, 3), '0.025')

        //不設notional時全掃, 步數皆等於精確取整
        for (let c = C0; c <= C1; c++) {
            let k = toSteps(calcContractQuantity('33.33', c / 100, 3))
            if (k !== kFloorExact(3333, c)) {
                assert.fail(`精確 price=${c / 100} k=${k} exact=${kFloorExact(3333, c)}`)
            }
        }
    })

    it('未設notional時不補量, 結果同向下取整', () => {
        //settings未設notional時主函式取得'', 全掃
        for (let c = C0; c <= C1; c++) {
            let k = toSteps(calcContractQuantity('22.00', c / 100, 3, { quantityLow: 0.001, notional: '' }))
            if (k !== kFloorExact(2200, c)) {
                assert.fail(`未設 price=${c / 100} k=${k}`)
            }
        }

        //undefined、null、非數字亦視為未設定; 2210取整後名義19.89, 不補量應得0.009
        for (let notional of [undefined, null, 'abc']) {
            assert.strictEqual(calcContractQuantity('22.00', 2210, 3, { quantityLow: 0.001, notional }), '0.009', `notional=${notional}`)
        }
    })

    it('取整後不足quantityLow或為0時拋錯, 不補量', () => {
        //30000時取整為0, 不補成0.001(約30u)
        assert.throws(() => calcContractQuantity('22.00', 30000, 3, opt), /quantityLow/)

        //15000時取整為0.001, 不足quantityLow 0.002
        assert.throws(() => calcContractQuantity('22.00', 15000, 3, { quantityLow: 0.002, notional: 20 }), /quantityLow/)

        //未給quantityLow時取整為0亦拋錯
        assert.throws(() => calcContractQuantity('22.00', 30000, 3, { notional: 20 }), /quantity/)
        assert.throws(() => calcContractQuantity('22.00', 30000, 3), /quantity/)
    })

    it('uTrade < notional 拋錯', () => {
        assert.throws(() => checkUTradeNotional('19.99', 20), /notional/)
        assert.doesNotThrow(() => checkUTradeNotional('20.00', 20))

        //未設notional不檢
        assert.doesNotThrow(() => checkUTradeNotional('19.99', ''))

        //2400時若僅補量可得0.009名義21.6, 但uTrade低於notional即拋錯
        assert.throws(() => calcContractQuantity('19.99', 2400, 3, opt), /notional/)
    })

    it('經opBinaContractMarket時, uTrade < notional 於任何API呼叫前拋錯', async () => {
        //basePathTest指向未開之本機埠: 若先呼叫API會得連線錯誤而非notional錯誤
        let st = {
            symbol: 'ETHUSDT',
            uTrade: 10,
            notional: 20,
            quantityLow: 0.001,
            digPrice: 2,
            digContractQuantity: 3,
            binance: {
                forTest: true,
                basePathTest: 'http://127.0.0.1:9',
                apiContractTest: { key: 'k', secret: 's' },
            },
        }
        await assert.rejects(webina.opBinaContractMarket(st, ott, 'long', 'tdid-unit', 19.5, 0.08, 0.05, { forceTest: true }), /notional/)
    })

    it('無效輸入拋錯', () => {
        for (let u of ['abc', 0, -1, '']) {
            assert.throws(() => calcContractQuantity(u, 3000, 3), Error, `uTrade=${u}`)
        }
        for (let p of ['abc', 0, -1, '']) {
            assert.throws(() => calcContractQuantity('22.00', p, 3), Error, `price=${p}`)
        }
        for (let d of ['', -1, 1.5, 'abc']) {
            assert.throws(() => calcContractQuantity('22.00', 3000, d), Error, `digContractQuantity=${d}`)
        }
    })

})
