import {f} from '../f'
import {inspect} from 'util'
import {createContext} from 'vm'

export function d(v :any) {
  console.log('d:', inspect(v))
  createContext()
  return f(v * 2)
}
