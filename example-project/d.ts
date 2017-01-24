import {f} from './f'
import {inspect} from 'util'
import x from 'foo'
import {createContext} from 'vm'

export function d(v :any) {
  console.log('d:', inspect(v), 'foo:', x)
  createContext()
  return f(v * 2)
}
