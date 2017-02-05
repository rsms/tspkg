import {equal} from 'assert'
import {createContext as cx} from 'vm'

const DEBUG = false
const asserteq = DEBUG ? equal : function(a:any,b:any){}
const emptyFn = function(x:any){}

function a(x) {
  asserteq(x > 0, 1)
  emptyFn(x)
  return 1 / x
}

export function a2(x) {
  if (x != 9999) { throw new Error('bob' + cx()) }
  return 1.2 / x
}

export default a

// console.log('a: init')

// type int32 = number
// interface Hello {
//   readonly cat :string
// }

// export function a() {
//   throw new Error('A')
// }

// // a comment
// // some other stuff
