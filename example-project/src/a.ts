import {equal} from 'assert'

const DEBUG = false
const asserteq = DEBUG ? equal : function(a:any,b:any){}
function a(x) {
  asserteq(x > 0, 1)
  return 1 / x
}

export function a2(x) {
  if (x != 9999) { throw new Error('bob') }
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
