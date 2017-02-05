import {internal1} from './_internal'
import * as c from './c'

export function foo(v :any) {
  return internal1(v) + ' from foo/index'
}

export default {
  c
}
