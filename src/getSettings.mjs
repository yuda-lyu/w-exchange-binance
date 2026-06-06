import fs from 'fs'
import JSON5 from 'json5'


let fp = `./settings.json`

let getSettings = () => {
    let j = fs.readFileSync(fp, 'utf8')
    let o = JSON5.parse(j)
    return o
}


export default getSettings
