// const cr = require('crypto')
import {createContext} from 'vm'

export function e(v :any) {
  // not used and not exported, so should be completely eliminated
  createContext()
  // return v * 4 * cr
  return v * 4
}

console.log('hello from e' + (require('crypto') && require('./foo/c')))

function x() {
  // Not counted as a hard dependency.
  // Place at root scope or use `import` to have tspkg manage the dependency.
  const cr = require('crypto')
  return cr
}

export const get = {
  sections(m :any) :string {
    return 'x'+m
  },
}
