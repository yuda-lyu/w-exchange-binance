import net from 'net'


//網路守門: 全部測試共用, 只放行loopback; 明確啟用連外測試(BINA_LIVE_TEST=1)時另放行測試端點主機, 正式主機一律拒絕
let HOSTS_LIVE = ['demo-fapi.binance.com', 'testnet.binancefuture.com']


let bLive = process.env.BINA_LIVE_TEST === '1'


let blocked = []


let isLoopback = (host) => {
    return /^(127\.0\.0\.1|localhost|::1|::ffff:127\.0\.0\.1)$/.test(host)
}


let installGuard = () => {
    if (net.Socket.prototype.__binaGuard) {
        return
    }
    let origConnect = net.Socket.prototype.connect
    net.Socket.prototype.connect = function(...args) {
        let o = args[0]
        if (Array.isArray(o)) {
            o = o[0]
        }
        let host = (o && typeof o === 'object') ? (o.host || o.hostname || 'localhost') : (typeof args[1] === 'string' ? args[1] : 'localhost')
        if (o && o.path) {
            host = 'localhost'
        }
        if (!isLoopback(host) && !(bLive && HOSTS_LIVE.includes(host))) {
            blocked.push(host)
            throw new Error(`NET-GUARD blocked host`)
        }
        return origConnect.apply(this, args)
    }
    net.Socket.prototype.__binaGuard = true
}
installGuard()


export { blocked, bLive, HOSTS_LIVE }
