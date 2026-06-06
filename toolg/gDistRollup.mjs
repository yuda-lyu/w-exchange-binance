import rollupFiles from 'w-package-tools/src/rollupFiles.mjs'
import getFiles from 'w-package-tools/src/getFiles.mjs'


let fdSrc = './src'
let fdTar = './dist'


rollupFiles({
    fns: 'WExchangeBinance.mjs',
    fdSrc,
    fdTar,
    nameDistType: 'kebabCase',
    globals: {
        'path': 'path',
        'fs': 'fs',
        'crypto': 'crypto',
        'https': 'https',
        'os': 'os',
        'events': 'events',
    },
    external: [
        'path',
        'fs',
        'crypto',
        'https',
        'os',
        'events',
    ],
})

