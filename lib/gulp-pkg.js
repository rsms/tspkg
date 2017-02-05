'use strict'
const DEBUG = 1
const through = require('through2')
const Path = require('path')
const File = require('vinyl')
const Concat = require('concat-with-sourcemaps')
const util = require('util')
const gutil = require('gulp-util')
const assert = DEBUG ? require('assert') : function(){}
const {DAG} = require('./toposort.js')
const {
  TSPkgError,
  hasRelativePathPrefix,
  moduleIdFromFilename,
  stripFileExt,
  isValidIdentifier,
} = require('./util.js')

function repr(v, depth) {
  return util.inspect(v, {colors:true, depth:depth})
}

function moduleIsPrivate(moduleId) {
  return moduleId[0] == '_'
}

function filenameIsPrivate(filename) {
  // true if any part of the path begins with "_" or "."
  return filename[0] == '_' ||
         filename[0] == '.' || 
         filename.indexOf('/_') != -1 ||
         filename.indexOf('/.') != -1
}

function commaPrefixedJSONList(values) {
  let s = ''
  for (let val of values) {
    s += ',' + val
  }
  return s
}

function unresolvedDependencyError(intDeps, moduleIds, depId) {
  // error TSPKG2
  const dependant = Array.from(intDeps.dependantsOf(depId) || [])
  const dependants = dependant ?
    dependant.map(id => {
      const file = moduleIds.get(id)
      return JSON.stringify(file ? file.relative : id)
    }) :
    ['?']
  return TSPkgError(
    null,
    TSPkgError.UNRESOLVED_DEPENDENCY,
    `Unresolved dependency "${depId}" imported by ${dependants.join(', ')}`
  )
}


// unifyImports(sources :string[], ids :string[])
//   :{sources :string[], ids :string[], consts :string[]}
function unifyImports(sources, ids) {
  // simplify external imports
  // E.g.:
  //   sources: [ 'assert', 'util', 'foo', 'vm', 'vm', 'crypto', 'fs' ],
  //   ids:     [ 'a0',     'd1',   'd2',  'd4', 'e0', 'e1',     'f0' ]
  //   unique:
  //     assert => { 'a0' }
  //     util   => { 'd1' }
  //     foo    => { 'd2' }
  //     vm     => { 'd4', 'e0' }
  //     crypto => { 'e1' }
  //     fs     => { 'f0' } }
  //
  assert(sources.length == ids.length)
  const consts = []
  const uniqueSources = []
  const uniqueIds = []
  const uniqueSourceToIdMap = new Map

  for (let i = 0, L = sources.length; i < L; ++i) {
    let source = sources[i], id = ids[i]
    const canonId = uniqueSourceToIdMap.get(source)
    if (canonId) {
      consts.push(id + ' = ' + canonId)
    } else {
      uniqueSources.push(source)
      uniqueIds.push(id)
      uniqueSourceToIdMap.set(source, id)
    }
  }

  return {sources: uniqueSources, ids: uniqueIds, consts: consts}
}


// file can be a vinyl file object or a string
// when a string it will construct a new one
module.exports = function(cfg) {
  if (!cfg) {
    throw new Error('pkg: missing configuration');
  }

  // contains all input files 
  const inFiles = new Map  // relative-filename => File
  const inFilesNoExt = new Map


  function finalize(cb) {
    if (inFiles.size == 0) {
      // no input
      cb(); return
    }

    // Sort input files by name to make result deterministic
    const inNames = Array.from(inFiles.keys())

    // Dependency registration
    const intDeps = new DAG // internal dependeny graph

    // Package exports
    const pkgExports = new Map
      // modName :string => {id :string, exports: string[], sourceFile :string}

    // Package imports
    let pkgImports = {sources:[], ids:[]}
      // two arrays are "in sync" and correlate

    // Package helpers (names)
    const pkgHelpers = new Set // {helperName :string}

    // Map module ids to files
    const moduleIds = new Map
    const sourceFiles = new Map // e.g. "foo/bar.js" => File{}
    inFiles.forEach((file, filename) => {
      moduleIds.set(file.babel.tspkg.moduleId, file)

      let sourceFilename = filename
      const sm = file.sourceMap
      if (sm && sm.sources && sm.sources[0]) {
        assert(sm.sources.length == 1)
        sourceFilename = sm.sources[0]
      }

      file._tspkgOriginalSourceFilename = sourceFilename
      sourceFiles.set(sourceFilename, file)
    })

    //console.log('moduleIds:', moduleIds.keys())
    //console.log('sourceFiles:', sourceFiles)

    for (let [filename, file] of inFiles) {
      const sourceFilename = file._tspkgOriginalSourceFilename
      const moduleId       = file.babel.tspkg.moduleId
      
      // accumulate helpers
      file.babel.usedHelpers.forEach(helperName =>
        pkgHelpers.add(helperName))
      
      if (cfg.verbose > 1) {
        console.log(`[pkg] source file: ${sourceFilename}, id: ${moduleId}`)
      }

      intDeps.add(sourceFilename, null)

      if (!filenameIsPrivate(sourceFilename)) {
        // only export modules which are not private
        const modName = stripFileExt(sourceFilename)
        pkgExports.set(modName, {
          id: moduleId,
          exports: file.babel.tspkg.exports,
          sourceFile: sourceFilename,
        })
      }

      // Sort imports to make result deterministic
      const internalImports = Array.from(file.babel.tspkg.imports.internal).sort((a, b) =>
        a < b ? -1 :
        a > b ?  1 :
                 0)

      const externalImports = Array.from(file.babel.tspkg.imports.external).sort((a, b) =>
        a[0] < b[0] ? -1 :
        a[0] > b[0] ?  1 :
                       0)

      for (const impSrcfile of internalImports) {
        // let dep = resolveRelativeModule(sourceFilename, impPath, sourceFiles)
        if (!sourceFiles.has(impSrcfile)) {
          return cb(TSPkgError(null, TSPkgError.UNRESOLVED_DEPENDENCY,
            `Unresolved dependency "${impSrcfile}" imported by "${sourceFilename}"`))
        }
        intDeps.add(sourceFilename, impSrcfile)
        // console.log('reg dep', sourceFilename, '->', impSrcfile)
      }

      for (const imp of externalImports) {
        pkgImports.sources.push(imp[0])
        pkgImports.ids.push(imp[1])
      }
    } // for-each inFiles

    // topological sort of internal dependencies. Also detects cycles.
    const sortedInternalDeps = intDeps.toposort((dependantId, dependencyId) => {
      // callback on circular dependency
      const path = intDeps.findPath(dependantId, dependencyId)
      // TODO: get file from modules.get(dependantId) and look up source filename
      // via sourcemap (or somehow look it up), or we'd get things like "foo.js"
      // for actual filename "foo.ts".
      cb(TSPkgError(
        null,
        TSPkgError.DEPENDENCY_CYCLE,
        `Circular dependency: ${(path.push(dependantId) && path).join(' -> ')}`
      ));
    })
    if (!sortedInternalDeps) { return }

    // const declarations added to pkg header
    let headerConsts = []

    // unify imports
    pkgImports = unifyImports(pkgImports.sources, pkgImports.ids)
    if (pkgImports.consts.length) {
      headerConsts = headerConsts.concat(pkgImports.consts)
    }

    // log
    if (cfg.verbose) {
      console.log('[pkg] imports: ' + pkgImports.sources.map(JSON.stringify).join(', '))
      console.log('[pkg] exports: ' + Array.from(pkgExports.keys()).map(modName => {
        const exportedIds = pkgExports.get(modName).exports
        return modName + (exportedIds.length ? '{' + exportedIds.join(', ') + '}' : '')
      }).join(', '))
      if (cfg.verbose > 1) {
        console.log('[pkg] dependency order', sortedInternalDeps.join(', '))
        console.log('[pkg] dependency graph\n' + intDeps.toDotString())
      }
    }

    // console.log('pkgExports.keys():', pkgExports.keys())
    // console.log('pkgImports:', pkgImports)
    // console.log('headerConsts:', headerConsts)
    // console.log('pkgHelpers:', pkgHelpers)

    // data needed by header and footer
    const pkgNameJS = JSON.stringify(cfg.pkgname)
    const importRefsJS = commaPrefixedJSONList(pkgImports.sources.map(JSON.stringify))
    const importIdsJS = commaPrefixedJSONList(pkgImports.ids)
    
    // helpers
    let helpersJS = ''
    if (pkgHelpers.size) {
      const helpers = new Map([
        ['interopRequireDefault', `(obj) {
            return obj && obj.__esModule ? obj : { default: obj };
        }`],
      ])
      helpersJS = 'H = {'
      let count = pkgHelpers.size
      for (let helperName of pkgHelpers) {
        const helperCode = helpers.get(helperName)
        if (helperCode) {
          helpersJS += helperName + helperCode
          if (--count) {
            helperJS += ','
          }
        }
      }
      helpersJS += '}'
    }
    
    // exports
    let hasDefaultExport = false
    let exportJS = ''
    let term = (cfg.compress ? ';' : ';\n')
    const indexSuffix = "/index"
    const toJSProp = function(name) {
      if (isValidIdentifier(name)) {
        return '.' + name
      } else {
        return '["' + name.replace(/\"/g, '\\"') + '"]'
      }
    }
    for (const [modName, info] of pkgExports) {
      const modId = '_$' + info.id

      if (modName == 'index') {
        // package default
        for (let exportedName of info.exports) {
          if (exportedName == 'default') {
            // E.default = x.default
            exportJS += 'E.default=' + modId + '.default' + term
            hasDefaultExport = true
          } else {
            // E.bob = x.bob
            exportJS += 'E' + toJSProp(exportedName) + '=' +
                        modId + '$' + exportedName + term
          }
        }
        if (!hasDefaultExport) {
          // E.default = x
          exportJS += 'E.default=' + modId + term
        }
      } else if (modName.endsWith(indexSuffix)) {
        // submodule default
        const modName2 = modName.substr(0, modName.length - indexSuffix.length)
        exportJS += 'E' + toJSProp(modName2) + '='
        let hasDefault = false
        if (info.exports.indexOf('default') != -1) {
          exportJS += modId + '.default' + term
          if (info.exports.length > 1) {
            console.warn(
              `${info.sourceFile}: Warning: default export shadows non-default exports ` +
              info.exports.filter(e => e != 'default').join(', ')
            )
          }
        } else {
          exportJS += modId + term
        }

      } else {
        // submobule of package
        exportJS += 'E' + toJSProp(modName) + '=' + modId + term
      }
    }

    // configure Concat
    const someFile = sourceFiles.get(sortedInternalDeps[0])
    const useSourceMaps = !!someFile.sourceMap
    const concat = new Concat(useSourceMaps, cfg.outfile + '.js', cfg.compress ? ';' : '\n');
    const defaultExportJS = hasDefaultExport ? '' : 'E.default=E;\n'

    // M constant
    headerConsts.push('M = {__esModule: true}')

    // generate header
    let header = `
    ( typeof define != "undefined" ? define :
      (function(g,R) { "use strict"; return function(i,d,f){
        R = R || function(i){return g[i];};
        f.apply(g,
          [
            R,
            typeof exports != "undefined" ? exports : (g[i]={})
          ].concat(d.slice(2).map(R))
        );
      };})(
        this,
        typeof require != "undefined" ? require : 0
      )
    )(${pkgNameJS},["require","exports"${importRefsJS}],function(R, E${importIdsJS}){
      "use strict";
      Object.defineProperty(E,'__esModule',{value:true}); ${defaultExportJS}
      const ${headerConsts.join(',')}${helpersJS ? ',' + helpersJS : ''};
    `.replace(/\r?\n\s+/g, '')

    // generate footer
    let footer = `${exportJS}});`.replace(/\r?\n\s+/g, '')

    // write header
    concat.add(null, Buffer.from(header, 'utf8'))

    // Tracks most recently modified file
    let latestFile, latestMod

    // Concatenate all files in order from most depended on to least depended on.
    // TODO: have this be the ordered list of dependencies instead
    for (let sourceFilename of sortedInternalDeps) {
      const file = sourceFiles.get(sourceFilename)
      assert(file)

      concat.add(file.relative, file.contents, file.sourceMap);

      // set latest file if not already set,
      // or if the current file was modified more recently.
      if (!latestMod || file.stat && file.stat.mtime > latestMod) {
        latestFile = file;
        latestMod = file.stat && file.stat.mtime;
      }
    }

    concat.add(null, Buffer.from(footer, 'utf8'))

    const outfile = latestFile.clone({contents: false})
    outfile.babel = null
    outfile.base = cfg.outdir
    outfile.path = cfg.outfileabs.substr(-3) == '.js' ? cfg.outfileabs : cfg.outfileabs + '.js'
    outfile.contents = concat.content

    if (concat.sourceMapping) {
      outfile.sourceMap = JSON.parse(concat.sourceMap)
    }

    this.push(outfile);
    cb();
  }


  function takeInput(file, encoding, cb) {
    if (file.isNull()) {
      // ignore
      cb();
      return;
    }

    if (file.isStream()) {
      this.emit('error', new Error('gulp-concat: Streaming not supported'));
      cb();
      return;
    }

    file.encoding = encoding
    inFiles.set(file.relative, file)
    inFilesNoExt.set(stripFileExt(file.relative), file)

    cb();
  }

  return through.obj(takeInput, finalize);
};
