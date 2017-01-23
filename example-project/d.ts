import {f} from './f'
import {inspect} from 'util'
import x from 'foo'

export function d(v :any) {
  console.log('d:', inspect(v), 'foo:', x)
  return f(v * 2)
}
