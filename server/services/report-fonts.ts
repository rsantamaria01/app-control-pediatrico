import { readFileSync } from 'node:fs'

const assetRoot = process.env.NODE_ENV === 'production' ? '.output/public' : 'server/assets/fonts'
export const notoSansRegular = readFileSync(`${assetRoot}/noto-sans-latin-400-normal.ttf`)
export const notoSansBold = readFileSync(`${assetRoot}/noto-sans-latin-700-normal.ttf`)
