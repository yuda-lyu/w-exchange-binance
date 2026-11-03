import http from 'http'
import { blocked } from './binaNetGuard.mjs'


//本機假交易所: 決定性測試用, 只監聽127.0.0.1之固定埠; 金鑰皆為假值. 以X-MBX-APIKEY區分情境, 可並行
//狀態機模擬幣安實測行為(bx297 §4): 已成交後同ID可重送、開啟中同ID -4116、查無-2013、撤無-2011、觸發成交後ID不佔位
//故障注入: fx.on(key, [filter,] 動作序列), 動作用完回預設行為
//  動作: { exec:true|false, reply:'hang'|'reset'|{status,body}|fn(ctx), before:async fn(ctx) }
//  exec:true=先套用狀態變化(伺服器已處理)再依reply回應; exec:false=不套用


let PORT = 8297
let BASE = `http://127.0.0.1:${PORT}`


let r2013 = { status: 400, body: { code: -2013, msg: 'Order does not exist.' } }
let r2011 = { status: 400, body: { code: -2011, msg: 'Unknown order sent.' } }
let r4116 = { status: 400, body: { code: -4116, msg: 'ClientOrderId is duplicated.' } }
let r1021 = { status: 400, body: { code: -1021, msg: 'Timestamp for this request is outside of the recvWindow.' } }


let scenarios = new Map()
let nScenario = 0


let isAcked = (o) => {
    return ['NEW', 'PARTIALLY_FILLED'].includes(o.status)
}


let mkExchange = (fx) => {

    let ex = {
        orders: [], //普通單, 同ID可多筆, 查單回最新
        algos: [],
        positions: {}, //positionSide -> amt
        markPrice: '3000.00',
        nextOrderId: 111,
        nextAlgoId: 222,
        nextListId: 601,
    }

    ex.addPos = (positionSide, qty) => {
        let v = Number(ex.positions[positionSide] || 0) + qty
        ex.positions[positionSide] = Number(v.toFixed(8))
    }

    ex.latestOrder = (cid) => {
        return [...ex.orders].reverse().find((o) => o.clientOrderId === cid) || null
    }

    ex.latestAlgo = (cid) => {
        return [...ex.algos].reverse().find((o) => o.clientAlgoId === cid) || null
    }

    ex.addOrder = (o) => {
        let order = {
            orderId: ex.nextOrderId++,
            symbol: 'ETHUSDT',
            status: 'FILLED',
            clientOrderId: `auto${ex.nextOrderId}`,
            origQty: '0.007',
            executedQty: '0.007',
            side: 'BUY',
            positionSide: 'LONG',
            type: 'MARKET',
            time: Date.now(),
            updateTime: Date.now(),
            ...o,
        }
        ex.orders.push(order)
        return order
    }

    ex.addAlgo = (o) => {
        let order = {
            algoId: ex.nextAlgoId++,
            clientAlgoId: `auto${ex.nextAlgoId}`,
            algoType: 'CONDITIONAL',
            orderType: 'STOP_MARKET',
            symbol: 'ETHUSDT',
            side: 'SELL',
            positionSide: 'LONG',
            quantity: '0.007',
            algoStatus: 'NEW',
            triggerPrice: '2900.00',
            actualQty: '0',
            createTime: Date.now() - 60000,
            updateTime: Date.now() - 60000,
            ...o,
        }
        ex.algos.push(order)
        return order
    }

    //預設行為: 回 { status, body }
    ex.handle = (key, p) => {
        switch (key) {

        case 'GET /fapi/v1/premiumIndex':
            return { status: 200, body: { symbol: p.get('symbol'), markPrice: ex.markPrice } }

        case 'GET /fapi/v1/exchangeInfo':
            return { status: 200, body: { symbols: [{ symbol: 'ETHUSDT', status: 'TRADING', pricePrecision: 2, quantityPrecision: 3, filters: [{ filterType: 'MIN_NOTIONAL', notional: '20' }] }] } }

        case 'GET /fapi/v3/account':
            return { status: 200, body: { totalWalletBalance: '1000', availableBalance: '1000', assets: [], positions: [] } }

        case 'GET /fapi/v3/positionRisk': {
            let rows = Object.entries(ex.positions)
                .filter(([, amt]) => Number(amt) !== 0)
                .map(([positionSide, amt]) => ({ symbol: p.get('symbol'), positionSide, positionAmt: String(amt) }))
            return { status: 200, body: rows }
        }

        case 'POST /fapi/v1/leverage':
            return { status: 200, body: { symbol: p.get('symbol'), leverage: 1, maxNotionalValue: '300000000' } }

        case 'POST /fapi/v1/marginType':
        case 'POST /fapi/v1/positionSide/dual':
            return { status: 200, body: { code: 200, msg: 'success' } }

        case 'POST /fapi/v1/order': {
            let cid = p.get('newClientOrderId') || `auto${Date.now()}`
            let prev = ex.latestOrder(cid)
            if (prev && isAcked(prev)) {
                return r4116
            }
            let qty = p.get('quantity')
            let side = p.get('side')
            let positionSide = p.get('positionSide')
            let order = ex.addOrder({ symbol: p.get('symbol'), clientOrderId: cid, side, positionSide, origQty: qty, executedQty: qty, status: 'FILLED' })
            ex.addPos(positionSide, (side === 'BUY' ? 1 : -1) * Number(qty))
            if (p.get('newOrderRespType') === 'RESULT') {
                return { status: 200, body: order }
            }
            return { status: 200, body: { ...order, status: 'NEW', executedQty: '0.000' } }
        }

        case 'GET /fapi/v1/order': {
            let cid = p.get('origClientOrderId')
            let oid = p.get('orderId')
            let hit = cid ? ex.latestOrder(cid) : ex.orders.find((o) => String(o.orderId) === String(oid))
            return hit ? { status: 200, body: hit } : r2013
        }

        case 'GET /fapi/v1/openOrders':
            return { status: 200, body: ex.orders.filter(isAcked) }

        case 'GET /fapi/v1/allOrders':
            return { status: 200, body: ex.orders }

        case 'GET /fapi/v1/userTrades':
            return { status: 200, body: [] }

        case 'DELETE /fapi/v1/order': {
            let cid = p.get('origClientOrderId')
            let oid = p.get('orderId')
            let hit = cid ? ex.latestOrder(cid) : ex.orders.find((o) => String(o.orderId) === String(oid))
            if (!hit || !isAcked(hit)) {
                return r2011
            }
            hit.status = 'CANCELED'
            return { status: 200, body: hit }
        }

        case 'DELETE /fapi/v1/allOpenOrders':
            ex.orders.filter(isAcked).forEach((o) => {
                o.status = 'CANCELED'
            })
            return { status: 200, body: { code: 200, msg: 'The operation of cancel all open order is done.' } }

        case 'POST /fapi/v1/algoOrder': {
            let cid = p.get('clientAlgoId')
            let prev = ex.latestAlgo(cid)
            if (prev && prev.algoStatus === 'NEW') {
                return r4116
            }
            let algo = ex.addAlgo({
                symbol: p.get('symbol'),
                clientAlgoId: cid,
                orderType: p.get('type'),
                side: p.get('side'),
                positionSide: p.get('positionSide'),
                quantity: p.get('quantity'),
                triggerPrice: p.get('triggerPrice'),
                createTime: Date.now(),
                updateTime: Date.now(),
            })
            return { status: 200, body: algo }
        }

        case 'GET /fapi/v1/algoOrder': {
            let cid = p.get('clientAlgoId')
            let aid = p.get('algoId')
            let hit = cid ? ex.latestAlgo(cid) : ex.algos.find((o) => String(o.algoId) === String(aid))
            return hit ? { status: 200, body: hit } : r2013
        }

        case 'GET /fapi/v1/openAlgoOrders':
            return { status: 200, body: ex.algos.filter((o) => o.algoStatus === 'NEW') }

        case 'GET /fapi/v1/allAlgoOrders':
            return { status: 200, body: ex.algos }

        case 'DELETE /fapi/v1/algoOrder': {
            let cid = p.get('clientAlgoId')
            let aid = p.get('algoId')
            let hit = cid ? ex.latestAlgo(cid) : ex.algos.find((o) => String(o.algoId) === String(aid))
            if (!hit || hit.algoStatus !== 'NEW') {
                return r2011
            }
            hit.algoStatus = 'CANCELED'
            return { status: 200, body: { algoId: hit.algoId, clientAlgoId: hit.clientAlgoId, code: '200', msg: 'success' } }
        }

        case 'DELETE /fapi/v1/algoOpenOrders':
            ex.algos.filter((o) => o.algoStatus === 'NEW').forEach((o) => {
                o.algoStatus = 'CANCELED'
            })
            return { status: 200, body: { code: 200, msg: 'The operation of cancel all open order is done.' } }

        case 'POST /api/v3/order':
            return { status: 200, body: { symbol: p.get('symbol'), orderId: 501, clientOrderId: p.get('newClientOrderId') || 'auto', transactTime: Date.now(), executedQty: '0.00600000', cummulativeQuoteQty: '18.00000000', status: 'FILLED' } }

        case 'POST /api/v3/orderList/oco':
            return { status: 200, body: { orderListId: ex.nextListId++, listClientOrderId: p.get('listClientOrderId') || 'auto', symbol: p.get('symbol'), transactionTime: Date.now(), orders: [{ orderId: 1 }, { orderId: 2 }] } }

        case 'POST /api/v3/orderList/otoco':
            return { status: 200, body: { orderListId: ex.nextListId++, listClientOrderId: p.get('listClientOrderId') || 'auto', symbol: p.get('symbol'), transactionTime: Date.now(), orders: [{ orderId: 1 }, { orderId: 2 }, { orderId: 3 }] } }

        default:
            return { status: 404, body: { code: -1, msg: 'no route' } }
        }
    }

    return ex
}


let sendJson = (res, status, body) => {
    if (res.destroyed || res.writableEnded) {
        return
    }
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
}


let server = http.createServer((req, res) => {
    let chunks = []
    req.on('data', (d) => chunks.push(d))
    req.on('end', async () => {

        let u = new URL(req.url, BASE)
        let key = `${req.method} ${u.pathname}`
        let apiKey = String(req.headers['x-mbx-apikey'] || '')
        let sid = apiKey.replace(/^(PROD|TEST|SPOTPROD|SPOTTEST):/, '')
        let fx = scenarios.get(sid)
        if (!fx) {
            return sendJson(res, 404, { code: -1, msg: 'no scenario' })
        }

        //幣安官方判定: timestamp < serverTime + 1000 && serverTime - timestamp <= recvWindow
        let ts = Number(u.searchParams.get('timestamp'))
        let recvWindow = u.searchParams.get('recvWindow')
        let serverTime = Date.now()
        let age = ts ? serverTime - ts : null
        let tsOk = !ts || (ts < serverTime + 1000 && serverTime - ts <= Number(recvWindow || 5000))

        let row = {
            key,
            p: Object.fromEntries(u.searchParams.entries()),
            params: u.searchParams,
            t: Date.now() - fx.t0,
            age,
            timestamp: ts || null,
            keyKind: apiKey.split(':')[0],
            signed: u.searchParams.has('signature'),
            host: req.headers.host,
        }
        fx.reqs.push(row)

        //故障注入
        let act = null
        for (let rule of fx.rules) {
            if (rule.key === key && rule.seq.length > 0 && (!rule.filter || rule.filter(u.searchParams))) {
                act = rule.seq.shift()
                break
            }
        }

        let ctx = { fx, ex: fx.ex, p: u.searchParams, key, row }

        if (act && act.before) {
            await act.before(ctx)
        }

        //時間戳失效: 確定未執行
        if (!tsOk) {
            let b = r1021
            return sendJson(res, b.status, b.body)
        }

        //預設: 無動作者套用狀態; 有動作者依exec決定
        let exec = act ? act.exec === true || (act.exec === undefined && act.reply === undefined) : true
        let out = exec ? fx.ex.handle(key, u.searchParams) : null
        if (exec && act && act.after) {
            act.after(ctx, out)
        }

        let reply = act ? act.reply : undefined
        if (typeof reply === 'function') {
            reply = reply(ctx, out)
        }
        if (reply === 'hang') {
            fx.hangs.push(res)
            return
        }
        if (reply === 'reset') {
            req.socket.destroy()
            return
        }
        if (reply && typeof reply === 'object') {
            return sendJson(res, reply.status, reply.body)
        }
        if (!out) {
            out = fx.ex.handle(key, u.searchParams)
        }
        return sendJson(res, out.status, out.body)
    })
})


//不由伺服端關閉閒置連線: 否則用戶端可能恰於關閉時重用該連線而得非注入之重置, 測試不決定
server.keepAliveTimeout = 0


let nStarted = 0
let startFake = () => {
    nStarted++
    if (server.listening) {
        return Promise.resolve(BASE)
    }
    return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(PORT, '127.0.0.1', () => {
            resolve(BASE)
        })
    })
}


let stopFake = () => {
    nStarted--
    if (nStarted > 0 || !server.listening) {
        return Promise.resolve()
    }
    return new Promise((resolve) => {
        //用戶端連線池一併清掉, 下一檔之請求不會重用已關閉之連線
        http.globalAgent.destroy()
        server.closeAllConnections()
        server.close(() => resolve())
    })
}


//建立情境: 回 fx, fx.st為只含假金鑰與本機端點之設定
let mkFake = (extra = {}) => {
    let sid = `s${++nScenario}`
    let fx = {
        sid,
        reqs: [],
        rules: [],
        hangs: [],
        t0: Date.now(),
    }
    fx.ex = mkExchange(fx)
    fx.on = (key, a, b) => {
        let filter = b === undefined ? null : a
        let seq = b === undefined ? a : b
        fx.rules.push({ key, filter, seq: [...seq] })
        return fx
    }
    fx.count = (key, filter = null) => {
        return fx.reqs.filter((r) => r.key === key && (!filter || filter(r.params))).length
    }
    fx.reqsOf = (key, filter = null) => {
        return fx.reqs.filter((r) => r.key === key && (!filter || filter(r.params)))
    }
    fx.st = {
        forTestAll: true,
        symbol: 'ETHUSDT',
        uTrade: 5,
        quantityLow: 0.001,
        digPrice: 2,
        digSpotQuantity: 4,
        digContractQuantity: 3,
        notional: 20,
        binance: {
            basePath: `${BASE}/prod-must-not-be-used`,
            basePathTest: BASE,
            basePathSpot: `${BASE}/prod-must-not-be-used`,
            basePathSpotTest: BASE,
            apiSpot: { key: `SPOTPROD:${sid}`, secret: 'fake-secret-spot-prod' },
            apiSpotTest: { key: `SPOTTEST:${sid}`, secret: 'fake-secret-spot-test' },
            apiContract: { key: `PROD:${sid}`, secret: 'fake-secret-prod' },
            apiContractTest: { key: `TEST:${sid}`, secret: 'fake-secret-test' },
        },
        ...extra,
    }
    scenarios.set(sid, fx)
    return fx
}


//記錄觀察回調事件, 測試以事件內容斷言
let mkTraceRec = () => {
    let evs = []
    return {
        evs,
        onTrace: (e) => {
            evs.push(e)
        },
        ofType: (type) => evs.filter((e) => e.type === type),
    }
}


//等被測物拋錯並回錯誤物件; 未拋則失敗
let catchErr = async (p) => {
    let v
    try {
        v = await p
    }
    catch (err) {
        return err
    }
    throw new Error(`expected rejection, got resolve: ${JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x))}`)
}


export {
    BASE,
    PORT,
    blocked,
    r2011,
    r2013,
    r4116,
    r1021,
    startFake,
    stopFake,
    mkFake,
    mkTraceRec,
    catchErr
}
