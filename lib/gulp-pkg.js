'use strict'

const through = require('through2')
const Path = require('path')
const File = require('vinyl')
const Concat = require('concat-with-sourcemaps')
const util = require('util')
const gutil = require('gulp-util')
const {DAG} = require('./toposort.js')
const { TSPkgError, hasRelativePathPrefix, moduleIdFromFilename } = require('./util.js')

function repr(v, depth) {
  return util.inspect(v, {colors:true, depth:depth})
}

function moduleIsPrivate(moduleId) {
  return moduleId[0] == '_'
}

function commaPrefixedJSONList(values) {
  const s = values.join(',')
  return s ? (',' + s) : s
}

function unresolvedDependencyError(intDeps, modules, depId) {
  // error TSPKG2
  const dependant = Array.from(intDeps.dependantsOf(depId) || [])
  const dependants = dependant ?
    dependant.map(id => {
      const file = modules.get(id)
      return JSON.stringify(file ? file.relative : id)
    }) :
    ['?']
  return TSPkgError(
    null,
    TSPkgError.UNRESOLVED_DEPENDENCY,
    `Unresolved dependency "${depId}" imported by ${dependants.join(', ')}`
  )
}


// file can be a vinyl file object or a string
// when a string it will construct a new one
module.exports = function(cfg) {
  if (!cfg) {
    throw new Error('pkg: missing configuration');
  }

  // contains all input files 
  const inFiles = new Map  // relative-filename => File


  function finalize(cb) {
    if (cfg.verbose) { console.log('[pkg] build') }

    if (inFiles.size == 0) {
      // no input
      cb(); return
    }

    // Sort input files by name to make result deterministic
    const inNames = Array.from(inFiles.keys())

    // Dependency registration
    const intDeps = new DAG // internal dependeny graph
    const modules = new Map // moduleId => File

    // Package exports
    const pkgExports = new Map // moduleId :string => id :string[]

    // Package imports
    const pkgImports = {refs:[], ids:[]} // two arrays are "in sync" and correlate

    // Package helpers (names)
    const pkgHelpers = new Set // {helperName :string}

    for (let filename of inNames) {
      const file = inFiles.get(filename)
      // file.babel = {
      //   usedHelpers: [],
      //   marked: [],
      //   modules: {
      //     imports: [
      //       { source: 'assert',
      //         imported: [ 'equal' ],
      //         specifiers: [
      //           { kind: 'named', imported: 'equal', local: 'equal' }
      //           ...
      //         ]}
      //       { source: './a',
      //         imported: [ 'a' ],
      //         specifiers: [
      //           { kind: 'named', imported: 'a', local: 'a' },
      //           ...
      //         ]}
      //       ...
      //     ],
      //     exports: {
      //       exported: [ 'a', 'x' ],
      //       specifiers: [
      //         { kind: 'local',
      //           local: 'a',
      //           exported: 'a' },
      //         { kind: 'local',
      //           local: 'x',
      //           exported: 'x' },
      //         ...
      //       ]}
      //   }
      // }

      // file.babel mock data:
      // file.babel = {usedHelpers:[],modules:{imports:[]}}
      // file.babel.tspkg = {moduleName:'x', imports:new Set}

      const moduleId = file.babel.tspkg.moduleName
      file.babel.usedHelpers.forEach(helperName => pkgHelpers.add(helperName))

      intDeps.add(moduleId, null)
      modules.set(moduleId, file)

      if (!moduleIsPrivate(moduleId)) {
        // only export modules which are not private
        pkgExports.set(moduleId, file.babel.tspkg.exports)
      }

      // Sort imports to make result deterministic
      const imports = file.babel.modules.imports.sort((a, b) => 
        a.source < b.source ? -1 :
        a.source > b.source ? 1 :
        0
      )

      for (const imp of imports) {
        let depId = imp.source
        // If an import has the prefix "./" or "../", it's internal and we consider it
        // part of the package. Otherwise it's external and not included in the package.
        if (hasRelativePathPrefix(depId)) {
          // internal dependency
          depId = Path.join(Path.dirname(moduleId), depId)
          intDeps.add(moduleId, depId)
        } // else: external/package dependency
      }

      // external imports
      file.babel.tspkg.imports.forEach((id, source) => { // imports : Map { 'assert' => 'a0' }
        pkgImports.ids.push(id)
        pkgImports.refs.push(source)
      })
    }

    // topological sort of internal dependencies. Also detects cycles.
    const sortedInternalDeps = intDeps.toposort((dependantId, dependencyId) => {
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

    if (cfg.verbose) {
      console.log('[pkg] imports ' + pkgImports.refs.map(JSON.stringify).join(', '))
      console.log('[pkg] exports ' + Array.from(pkgExports.keys()).map(modId => {
        const exportedIds = pkgExports.get(modId)
        return modId + (exportedIds.length ? '{' + exportedIds.join(', ') + '}' : '')
      }).join(', '))
      if (cfg.verbose > 1) {
        console.log('[pkg] dependency order', sortedInternalDeps.join(', '))
        console.log('[pkg] dependency graph\n' + intDeps.toDotString())
      }
    }

    // console.log('pkgExports.keys():', pkgExports.keys())
    // console.log('pkgImports:', pkgImports)
    // console.log('pkgHelpers:', pkgHelpers)

    // data needed by header and footer
    const pkgNameJS = JSON.stringify(cfg.pkgname)
    const importRefsJS = commaPrefixedJSONList(pkgImports.refs.map(JSON.stringify))
    const importIdsJS = commaPrefixedJSONList(pkgImports.ids)
    
    // helpers
    let helpersJS = ''
    if (pkgHelpers.size) {
      const helpers = new Map([
        ['interopRequireDefault', `(obj) {
            return obj && obj.__esModule ? obj : { default: obj }
        }`],
      ])
      helpersJS = ',H = {'
      for (let helperName of pkgHelpers) {
        const helperCode = helpers.get(helperName)
        if (helperCode) {
          helpersJS += helperName + helperCode + ','
        }
      }
      helpersJS += '}'
    }
    
    // exports
    let exportJS = ''
    for (let id of pkgExports.keys()) {
      exportJS += 'E.' + id + '=_$' + id + (cfg.compress ? ';' : ';\n')
    }

    // configure Concat
    const someFile = modules.get(sortedInternalDeps[0])
    const useSourceMaps = !!someFile.sourceMap
    const concat = new Concat(useSourceMaps, cfg.outfile + '.js', cfg.compress ? ';' : '\n');

    // generate header
    let header = `
    ( typeof define!="undefined"?define:
      (function(g,R) { return function(i,d,f){
        R=R||function(i){return g[i]};
        f.apply(g,
          [
            R,
            typeof exports!="undefined"?exports:g[i]={}
          ].concat(d.slice(2).map(R))
        )
      }})(
        this,
        typeof require!="undefined"?require:0
      )
    )(${pkgNameJS},["require","exports"${importRefsJS}],function(R,E${importIdsJS}){
      Object.defineProperty(E,'__esModule',{value:true});
      E.default = E;
      const M = {__esModule:true}${helpersJS};
    `.replace(/\r?\n\s+/g, '')

    // generate footer
    let footer = `${exportJS}});`//.replace(/\r?\n\s+/g, '')

    // write header
    concat.add(null, Buffer.from(header, 'utf8'))

    // Tracks most recently modified file
    let latestFile, latestMod

    // Concatenate all files in order from most depended on to least depended on.
    // TODO: have this be the ordered list of dependencies instead
    for (let moduleId of sortedInternalDeps) {
      const file = modules.get(moduleId)

      if (!file) {
        // error TSPKG2
        cb(unresolvedDependencyError(intDeps, modules, moduleId))
      }

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

    cb();
  }

  return through.obj(takeInput, finalize);
};
