import ot from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'


ot.extend(utc)
ot.extend(timezone)


let TZ = 'Asia/Taipei'


let ott = (input) => {
    if (input === undefined || input === null) {
        return ot().tz(TZ)
    }
    return ot.tz(input, TZ)
}


let nowTpeStr = () => ott().format('YYYY-MM-DDTHH:mm:ssZ')


let nowTpeStrp = () => ott().format('YYYYMMDDHHmmss')


export default ott
export { ott, nowTpeStr, nowTpeStrp }
