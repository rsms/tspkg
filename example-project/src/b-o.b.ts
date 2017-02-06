import a from './a'
import {a2} from './a'
import {d} from './foo/d.js'
import foo from 'foo'

export interface Bar {
  readonly done :number
}

export function x(v :any) {
  return a2(v) + foo
}

export function b(v :any) {
  return d(a(123 + v))
}
export interface Lolcat {
  name :string
}
