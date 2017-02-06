import {createContext} from 'vm'
export function f(v) { return v * 6 }

const fs = require('fs') // left untouched (by design)
require('crypto') // left untouched (by design)

function lol(v) {
  // not used and not exported, so should be completely eliminated
  return fs(createContext({v: v * 4}))
}
