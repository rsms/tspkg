// This would create a dependency cycle:
// import {b} from './b'
// export function f(v) { return b(v * 6) }
export function f(v) { return v * 6 }

const fs = require('fs') // ignored (left untouched) by tspkg (by design)

function lol(v) {
  // not used and not exported, so should be completely eliminated
  return v * 4
}
