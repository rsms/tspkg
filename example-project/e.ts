// const cr = require('crypto')
import {createContext} from 'vm'

function e(v :any) {
  // not used and not exported, so should be completely eliminated
  createContext()
  // return v * 4 * cr
  return v * 4
}

console.log('hello from e' && require('crypto') || require('./c').c)

const cr = require('crypto')
function x() {
  return cr
}
