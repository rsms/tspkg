import {get} from './e'

export function bob(x) {
  return x * 9.1
}

function start() {
  return get.sections('bob')
}

export default {
  start
}
