import a from '../a'
import {d} from './d.js'

const _$lolcat = 1234

console.log('c:', d(456 + a(789)), _$lolcat * 4)
                                   // ~~~~~~~~~~~~ should fold to `4936`
export interface C { c: number }

module.exports = _$lolcat
