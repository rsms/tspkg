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


const isIDRegExp = /^[A-Za-z_\$][0-9A-Za-z_\$]*$/

exports.isValidIdentifier = function(s) {
  return isIDRegExp.test(s)
}

function makeIdentifier(s) {
  return String(s)
    .replace(/\.+/g, '_')
    .replace(/^[^A-Za-z]+|[^0-9A-Za-z_]/g, '$')
    //.replace(/^\$+|\$+$/g, '')
}
exports.makeIdentifier = makeIdentifier


function stripFileExt(filename, onlyIfMatches) {
  const ext = Path.extname(filename)
  return (ext &&
          (!onlyIfMatches ||
            ext == onlyIfMatches ||
            (onlyIfMatches.has && onlyIfMatches.has(ext)) )) ?
    // Note: TypeScript does not allow import sources to end in ".ts".
    filename.substr(0, filename.length - ext.length) :
    filename
}
exports.stripFileExt = stripFileExt


function stripPathPrefix(filename) {
  // e.g. "./bob/cat"        => "bob/cat"
  // e.g. "../bob/cat.js"    => "bob/cat.js"
  // e.g. "/lol/src/bob/cat" => "lol/src/bob/cat"
  const c0 = filename.charCodeAt(0), c1 = filename.charCodeAt(1)
  if (c0 == 0x2e/*'.'*/) {
    if (c1 == 0x2f/*'/'*/) { // "./"
      return filename.substr(2)
    }
    if (c1 == 0x2e/*'.'*/ && filename.charCodeAt(2) == 0x2f/*'/'*/) { // "../"
      return filename.substr(3)
    }
  } else if (c0 == 0x2f/*'/'*/) {
    return filename.substr(1)
  }
  return filename
}
exports.stripPathPrefix = stripPathPrefix


exports.moduleIdFromFilename = function moduleIdFromFilename(filename) {
  // e.g. "./bob/cat"        => "bob$cat"
  // e.g. "../bob/cat.js"    => "bob$cat_js"
  // e.g. "/lol/src/bob/cat" => "lol$src$bob$cat"
  return makeIdentifier(stripPathPrefix(filename))
}
