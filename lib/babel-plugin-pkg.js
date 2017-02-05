"use strict";
exports.__esModule = true;
const Path = require('path')
const assert = require('assert')
const {
  TSPkgError,
  hasRelativePathPrefix,
  moduleIdFromFilename,
  stripFileExt,
  stripPathPrefix,
} = require('./util.js')

// const inspect = require('util').inspect;
// function dump(val, depth, showHidden) {
//   console.log(inspect(val, {colors:true, depth, showHidden}));
// }


// uid generator
function UIDGen(prefix) {
  let n = 0
  return prefix ?
    function uidgen(name) {
      return prefix + (n++).toString(36)
    } :
    function uidgen(name) {
      return (n % 36 > 9) ?
        (n++).toString(36) :
        '_' + (n++).toString(36)
    }
}


function isValidRequireCall(path) {
  if (!path.isCallExpression()) return false;
  if (!path.get("callee").isIdentifier({ name: "require" })) return false;
  if (path.scope.getBinding("require")) return false;

  var args = path.get("arguments");
  if (args.length !== 1) return false;

  var arg = args[0];
  if (!arg.isStringLiteral()) return false;

  return true;
}


const stripExternalFileExts = new Set([
  '.js',
  '.json',
  '.node'
])
  // see https://nodejs.org/dist/latest-v7.x/docs/api/modules.html#modules_all_together
const stripInternalFileExts = new Set(Array.from(stripExternalFileExts).concat([
  '.ts'
]))


function resolveModulePath(importerPath, importPath, fileMap) {
  // "./foo/bar.js" => "foo/bar.js" when fileMap has "foo/bar.js"
  // "./foo/bar.js" => null         when fileMap doesn't have "foo/bar.js" or "foo/bar.ts"
  // "./foo/bar"    => "foo/bar.ts" when fileMap has "foo/bar.ts"
  // "./foo/bar"    => "foo/bar.js" when fileMap has "foo/bar.js"
  // ...
  let path = stripPathPrefix(
    importerPath ? Path.join(Path.dirname(importerPath), importPath) : importPath
  )
  let path2
  return fileMap.has(path)                 ? path :
         fileMap.has(path2 = path + '.ts') ? path2 :
         fileMap.has(path2 = path + '.js') ? path2 :
                                             null
}


function resolveModuleId(importPath, sourceFiles, cfg, file) {
  if (!hasRelativePathPrefix(importPath)) {
    // external module
    return moduleIdFromFilename(stripFileExt(importPath, stripExternalFileExts))
  }

  const selfFilename = file.opts.sourceFileName
  // E.g. file.opts.
  //   sourceFileName: 'src/eval.ts'
  //   sourceRoot: '/Users/rsms/src/wasm-util'

  let srcpath = resolveModulePath(selfFilename, importPath, sourceFiles)

  if (!srcpath) {
    throw TSPkgError(null, TSPkgError.UNRESOLVED_DEPENDENCY,
      `Unresolved dependency "${importPath}" imported by "${selfFilename}" xx`)
  }

  return {
    id: moduleIdFromFilename(stripFileExt(srcpath, stripInternalFileExts)),
    filename: srcpath,
  }
}


module.exports = exports.default = function ({types: t}) {
  const removeOrVoid = require("babel-helper-remove-or-void")(t);


  const pkgVisitor = {
    ReferencedIdentifier(path, state) {
      const { node, scope } = path;
      if (node.name === "exports" && !scope.getBinding("exports")) {
        node.name = state.exportsId
      }
    },

    AssignmentExpression(path, state) {
      const { node, scope } = path;
      if (t.isMemberExpression(node.left)) {
        const id = node.left.object
        if (id && t.isIdentifier(id)) {
          
          if (id.name === "exports" && !scope.getBinding("exports")) {
            state.exports.set(node.left.property.name, {
              value: node.right,
                // must be a ref to the identifier so that scope renames propagate
              path,
            })
            // Note: We need to wait to remove path until after ID renaming

          } else if (id.name === "module" && !scope.getBinding("module")) {
            this.moduleExport.value = node.right
            this.moduleExport.path = path
          }

        }
      }
    },

    MemberExpression(path, state) {
      // exports.foo<obj#1> = foo<obj#1>  =>  exports.foo<obj#2> = foo<obj#1>
      // module.foo<obj#1> = foo<obj#1>   =>  module.foo<obj#2> = foo<obj#1>
      const { node, scope } = path;
      const id = node.object
      if (id && t.isIdentifier(id)) {
        if (id._internalModuleId && t.isIdentifier(node.property)) {
          const intFQName = '_$' + id._internalModuleId + '$' + node.property.name
          path.replaceWith(t.identifier(intFQName))
        }
      }
    },

    CallExpression(path, state) {
      const node = path.node
      if (isValidRequireCall(path)) {
        const source = node.arguments[0]
        const src = this.resolveModuleId(source.value)

        if (hasRelativePathPrefix(source.value)) {
          // internal dependency
          path.replaceWith(t.identifier('_$' + src.id))
          this.internalImports.add(src.filename)
        } else {
          // external dependency
          // Note: we choose to let `require()` expressions be left untouched.
          // However, `const x = require()` at root scope is still managed.
          //
          // let id = this.externalImports.get(source.value)
          // if (!id) {
          //   id = path.scope.generateUidIdentifier()
          //   id._externalModuleId = src.id
          //   this.externalImports.set(source.value, id)
          // }
          // path.replaceWith(id)
        }
      } else
      if (node.callee.object === this.helpersNS) {
        // call to a helper
        const helper = node.callee.property
        if (t.isIdentifier(helper) && helper.name == 'interopRequireDefault') {
          assert(node.arguments.length == 1)
          let target = node.arguments[0]
          if (t.isIdentifier(target) && target._internalModuleId) {
            // eliminate interopRequireDefault for inter-module imports
            const intFQName = '_$' + target._internalModuleId
            if (t.isVariableDeclarator(path.parent)) {
              // convert helper var declaration to const declaration
              path.parentPath.parentPath.node.kind = 'const'
            }
            path.replaceWith(t.identifier(intFQName))
            this.decrHelperUseCount(helper.name)
          }
        }
      }
    },

    VariableDeclarator(path) {
      var id = path.get("id");
      if (!id.isIdentifier()) { return }

      var init = path.get("init");
      if (!isValidRequireCall(init)) { return }

      if (path.scope.parent) { return } // not at root level

      const source = init.node.arguments[0]
      const src = this.resolveModuleId(source.value)

      if (hasRelativePathPrefix(source.value)) {
        // internal dependency
        id.node.name = '_$' + src.id
        id.node._internalModuleId = src.id
        this.internalImports.add(src.filename)

      } else {
        // external dependency
        let existingId = this.externalImports.get(source.value)
        if (existingId) {
          if (existingId.name != id.node.name) {
            path.scope.rename(id.node.name, existingId.name)
            id.node._externalModuleId = src.id
          }
        } else {
          if (id.node.loc) {
            path.scope.rename(id.node.name)
          }
          id.node._externalModuleId = src.id
          this.externalImports.set(source.value, id.node)
        }
      }

      path.remove();
    },
  };


  const postVisitor = {
    VariableDeclaration(path) {
      if (path.node.kind == 'const') {
        // remove uninitialized const declarations
        path.get('declarations').filter(decl => !decl.node.init).forEach(decl => {
          decl.remove()
        })
      }
    },

    // { ... c: _$src$ast.t = , ... } => {... ...}
    // ObjectExpression(path) {
    //   if (this.file.opts.sourceFileName == 'src/ast.ts') {
    //     console.log(path.node.properties)
    //     process.exit(1)
    //   }
    // }
  };


  return {
    inherits: require("./babel-plugin-transform-es2015-modules-commonjs.js"),

    pre(file) {
      this.exports = new Map    // id => {key: string, value: Expression, path: Path}
      this.externalImports = new Map // {source => id}
      this.internalImports = new Set // {source}
      this.moduleExport = {value:null, path:null}  // {value :Expression, path :Path}
        // non-null value if the module has module.exports=value

      const cfg = this.opts.tspkgConfig
      this.resolveModuleId = function(path) {
        return resolveModuleId(path, cfg.sourceFiles, cfg, file)
      }
      // this.resolveModulePath = function() {
      //   return resolveModulePath(file.opts.sourceFileName, path, cfg.sourceFiles)
      // }
      
      this.moduleId = moduleIdFromFilename(
        stripFileExt(file.opts.sourceFileName, stripInternalFileExts))
      
      if (cfg.verbose > 1) {
        console.log('[transform]', file.opts.sourceFileName)
      }
      
      const uidgen = UIDGen(this.moduleId)
      this.uidgen = function(name) {
        const uid = uidgen(name)
        const program = this.getProgramParent()
        program.references[uid] = true
        program.uids[uid] = true
        return uid
      }

      const self = this
      this.helperUseCounts = new Map  // helper-name => use-count

      this.incrHelperUseCount = function(name) {
        let count = this.helperUseCounts.get(name)
        if (!count) {
          count = 1
        }
        this.helperUseCounts.set(name, count)
      }

      this.decrHelperUseCount = function(name) {
        let count = this.helperUseCounts.get(name)
        if (count) {
          if (--count == 0) {
            this.helperUseCounts.delete(name)
          } else {
            this.helperUseCounts.set(name, count)
          }
        }
      }

      // shim addHelper so we can keep track of use count
      const addHelper = file.addHelper
      file.addHelper = function(name) {
        self.incrHelperUseCount(name)
        return addHelper.apply(this, arguments)
      }

      this.helpersNS = t.identifier("H")
      file.set("helpersNamespace", this.helpersNS)
    },

    visitor: {
      Scope: {
        enter(path) {
          // Patch scope to use out global uid generator to avoid producing
          // multiple files with the same identifier
          path.scope.generateUid = this.uidgen
        }
      },

      Program: {

        exit(path) {
          if (this.ran) return;
          this.ran = true;

          const { node, scope } = path;

          const moduleId = this.moduleId
          const exportsId = '_$' + moduleId
          const localIdPrefix = '_$' + moduleId + '$'

          // drop any directives e.g. "use strict"
          node.directives = []

          path.traverse(pkgVisitor, {
            __proto__: this,
            moduleId,
            exportsId,
            localIdPrefix,
          })

          const renamedBindings = new Map

          for (let k in scope.bindings) {
            const b = scope.bindings[k]
            if (!b.identifier._externalModuleId) {
              const newId = localIdPrefix + k
              renamedBindings.set(k, newId)
              path.scope.rename(k, newId)
            }
          }

          const depIds = []  // :Identifier[]
          const args = []    // :StringLiteral[]

          // update metadata.usedHelpers with out use-counted accurate knowledge
          // of what helpers are effectively in use.
          this.file.metadata.usedHelpers = Array.from(this.helperUseCounts.keys())

          // build header
          let moduleExpr, exportedNames = []
          if (this.moduleExport.value) {
            // one thing exported as `module.exports`
            if (this.exports.size != 0) {
              throw new Error('mixing module.exports with individual exports')
            }
            moduleExpr = this.moduleExport.value
            // remove the "module.exports = y" AssignmentExpression
            this.moduleExport.path.remove()

          } else {
            // individual things exported
            const exportsProps = [
              // const M = { __esModule: true }
              t.objectProperty(t.identifier('__proto__'), t.identifier('M'))
            ]
            for (let [expName, exp] of this.exports) {
              exportedNames.push(expName)

              let bindingId = renamedBindings.get(expName) || expName
              let b = path.scope.bindings[bindingId]
              if (t.isExpressionStatement(exp.path.parentPath)) {
                // e.g. `_$mod.bob = _$mod$bob;` => ``
                exportsProps.push(
                  t.objectProperty(t.identifier(expName), exp.value)
                )
                exp.path.remove()
              } else {
                // e.g. `const _$mod$bob = _$mod.bob = 1234;` => `const _$mod$bob = 1234;`
                exportsProps.push(
                  t.objectProperty(t.identifier(expName), t.identifier(bindingId))
                )
                exp.path.replaceWith(exp.value)
              }
            }
            moduleExpr = t.objectExpression(exportsProps) // { ...props }
          }

          node.body.push(
            // const _$foo = ...
            t.variableDeclaration('const', [
              t.variableDeclarator(
                t.identifier(exportsId),
                moduleExpr
              )
            ])
          )

          path.traverse(postVisitor, this)

          // clean up any "moduleid.foo = undefined"
          function rightIsNull(n) {
            if (!n || (t.isIdentifier(n) && n.name == 'undefined') || t.isNullLiteral(n)) {
              return true
            } else if (t.isAssignmentExpression(n)) {
              return rightIsNull(n.right)
            }
            return false
          }

          for (let p of path.get('body')) {
            let expr
            if (t.isExpressionStatement(p) &&
                t.isAssignmentExpression(expr = p.node.expression) &&
                t.isMemberExpression(expr.left) &&
                t.isIdentifier(expr.left.object) &&
                expr.left.object.name == exportsId )
            {
              if (rightIsNull(expr.right)) {
                p.remove()
              } else {
                console.warn("[babel-pkg] TODO: can't safely eliminate dead path")
                // Can't safely remove the path.
                // TODO: move to end of body
                // dump(expr, 2)
              }
            }
          }

          const externalImports = new Map
          this.externalImports.forEach((id, source) => {
            externalImports.set(source, id.name)
          })

          // tspkg metadata passed on to gulp as `file.babel`
          this.file.metadata.tspkg = {
            moduleId,
            moduleExport: this.moduleExport.value ? this.moduleExport.value.name : null,
            exports: exportedNames,
            imports: {
              external: externalImports,
              internal: this.internalImports,
            },
          }
        }
      }
    }
  };
};

module.exports = exports["default"];
