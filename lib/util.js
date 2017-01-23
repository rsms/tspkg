"use strict"
const {colors} = require('gulp-util')
const Path = require('path')

function TSPkgError(source, code, message) {
  // foo.ts:1:9: error TSPKG4: message
  let msg = ''
  if (source) {
    msg = source.filename + 
          (source.line ?  ':' + source.line : '') +
          (source.column ? ':' + source.column : '') +
          ': '
  }
  msg += 'error TSPKG' + code
  const e = new Error(`${msg}: ${message}`)
  e.styledMessage = `${colors.red.bold(msg)}: ${message}`
  e.name = 'TSPkgError'
  e.tspkgSource = source
  e.tspkgCode = code
  return e
}

exports.TSPkgError = TSPkgError

// Error codes
TSPkgError.DEPENDENCY_CYCLE = 1
TSPkgError.UNRESOLVED_DEPENDENCY = 2


exports.hasRelativePathPrefix = function hasRelativePathPrefix(s) {
  // "./bob"   => true
  // "../bob"  => true
  // ".../bob" => false
  // ".bob"    => false
  // "..bob"   => false
  // "bob"     => false
  return (
    s.charCodeAt(0) == 0x2e/*'.'*/ &&
      (s.charCodeAt(1) == 0x2f/*'/'*/ ||
        (s.charCodeAt(1) == 0x2e/*'.'*/ &&
         s.charCodeAt(2) == 0x2f/*'/'*/ )))
}


function makeIdentifier(s) {
  return String(s).replace(/^[^A-Za-z]+|[^0-9A-Za-z_]/g, '_').replace(/^_+|_+$/g, '')
}
exports.makeIdentifier = makeIdentifier


exports.moduleIdFromFilename = function moduleIdFromFilename(filename) {
  const ext = Path.extname(filename)
  if (ext) {
    filename = filename.substr(0, filename.length - ext.length)
  }

  const c0 = filename.charCodeAt(0)
  const c1 = filename.charCodeAt(1)
  if (c0 == 0x2e/*'.'*/) {
    if (c1 == 0x2f/*'/'*/) {
      // "./"
      filename = filename.substr(2)
    } else if (c1 == 0x2e/*'.'*/ && filename.charCodeAt(2) == 0x2f/*'/'*/) {
      // "../"
      filename = filename.substr(3)
    }
  } else if (c0 == 0x2f/*'/'*/) {
    filename = Path.basename(filename)
  }

  return makeIdentifier(filename)
}
