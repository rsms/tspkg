import {b} from './b'
import a from './a'
import {d} from './d'

const _$lolcat = 1234

console.log('c:', d(b(456) + a(789)), _$lolcat * 4)
                                   // ~~~~~~~~~~~~ should fold to `4936`

module.exports = _$lolcat
