// import template from "babel-template";
"use strict";
exports.__esModule = true;
const Path = require('path')
const assert = require('assert')
const { TSPkgError, hasRelativePathPrefix, moduleIdFromFilename } = require('./util.js')

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


const moduleName = Symbol('moduleName')

module.exports = exports.default = function ({types: t}) {
  const removeOrVoid = require("babel-helper-remove-or-void")(t);

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
            state.exports.add({
              key: node.left.property.name,
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
        // else if (id._externalModuleId) {
        //   console.log('TODO externalModuleId')
        //   dump(id, 1)
        // }
      }
    },

    CallExpression(path, state) {
      const node = path.node
      if (isValidRequireCall(path)) {
        this.bareSources.push(node.arguments[0]);
        path.remove();
      } else if (node.callee.object === this.helpersNS) {
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

      const source = init.node.arguments[0]
      const sourceModuleId = moduleIdFromFilename(source.value)

      if (hasRelativePathPrefix(source.value)) {
        // internal dependency
        id.node.name = '_$' + sourceModuleId
        id.node._internalModuleId = sourceModuleId
      } else {
        // external dependency
        id.node._externalModuleId = sourceModuleId
        assert(!this.externalImports.has(source.value)) // tsc & babel should normalize
        this.externalImports.set(source.value, id.node.name)
      }

      this.sourceNames.add(source.value)
      this.sources.push([id.node, source])

      path.remove();
    },
  };


  return {
    inherits: require("babel-plugin-transform-es2015-modules-commonjs"),

    pre(file) {
      this.sources = [];
      this.sourceNames = new Set
      this.bareSources = [];
      this.exports = new Set    // {key: string, value: Expression, path: Path}
      this.externalImports = new Map // source => id-name
      this.moduleExport = {value:null, path:null}  // {value :Expression, path :Path}
        // non-null value if the module has module.exports=value
      this.moduleName = this.getModuleName() || moduleIdFromFilename(file.opts.filenameRelative)
      
      const uidgen = UIDGen(this.moduleName)
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

          const moduleName = this.moduleName
          const exportsId = '_$' + moduleName
          const localIdPrefix = '_$' + moduleName + '$'

          // drop any directives e.g. "use strict"
          node.directives = []

          path.traverse(pkgVisitor, {
            __proto__: this,
            moduleName,
            exportsId,
            localIdPrefix,
          })

          for (let k in scope.bindings) {
            path.scope.rename(k, localIdPrefix + k);
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
            for (let e of this.exports) {
              exportedNames.push(e.key)
              exportsProps.push(
                t.objectProperty(t.identifier(e.key), e.value)
              )
              // remove the "exports.x = y" AssignmentExpression
              e.path.remove()
            }
            moduleExpr = t.objectExpression(exportsProps) // { ...props }
          }

          node.body.push(
            // a. const _$foo = Object.create(null, { __esModule: {value:true} })
            // b. const _$foo = { __proto__: { __esModule: true } }
            // c. const _$foo = { [Symbol.prototype]: { __esModule: true } }
            // d. const _$foo = {}
            t.variableDeclaration('const', [
              t.variableDeclarator(
                t.identifier(exportsId),
                moduleExpr
              )
            ])
          )

          // tspkg metadata passed on to gulp as `file.babel`
          this.file.metadata.tspkg = {
            moduleName,
            moduleExport: this.moduleExport.value ? this.moduleExport.value.name : null,
            exports: exportedNames,
            imports: this.externalImports,
          }
        }
      }
    }
  };
};

module.exports = exports["default"];
