import a from './a'
import {a2} from './a'
import {d} from './foo/d.js'

export interface Bar {
  readonly done :number
}

export function x(v :any) {
  return a2(v)
}

export function b(v :any) {
  return d(a(123 + v))
}
export interface Lolcat {
  name :string
}
