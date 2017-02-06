// folds expressions using constants, elimintates calls to empty functions, does DCE and CF.
"use strict";

// const inspect = require('util').inspect;
// function dump(val, depth, showHidden) {
//   console.log(inspect(val, {colors:true, depth, showHidden}));
// }

const isEmptyFunc = Symbol('is-empty-func')

module.exports = ({ types: t }) => {
  const removeOrVoid = require("babel-helper-remove-or-void")(t);

  function scopeFind(scope, name) { // : Binding
    let target = scope.globals[name];
    if (target || (target = scope.bindings[name])) {
      return target;
    }
    return scope.parent ? scopeFind(scope.parent, name) : null;
  }


  function isEmptyFunction(scope, node, meta, depth) {
    if (node[isEmptyFunc] !== undefined) {
      return node[isEmptyFunc]
    }

    if (!depth) {
      depth = 0;
    } else if (depth > 1000) {
      return node[isEmptyFunc] = false
    }

    if (t.isIdentifier(node)) {
      const binding = scopeFind(scope, node.name);
      if (binding && binding.path && 
          ( isBindingEmptyFunction(binding, meta, depth) ||
            isEmptyFunction(binding.scope, binding.path.node, meta, depth+1)
          )
         )
      {
        if (meta) { meta.binding = binding }
        return node[isEmptyFunc] = true
      }
    } else if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) {
      if (node.body && Array.isArray(node.body.body) && node.body.body.length === 0) {
        return node[isEmptyFunc] = true
      }
    }

    return node[isEmptyFunc] = false
  }


  function isBindingEmptyFunction(binding, meta, depth) {
    if (binding[isEmptyFunc] !== undefined) {
      return binding[isEmptyFunc];
    }
    const node = binding.path.node;
    if (binding.constant && t.isVariableDeclarator(node)) {
      if (isEmptyFunction(binding.scope, node.init, meta, depth+1)) {
        return binding[isEmptyFunc] = true
      }
    }
    return binding[isEmptyFunc] = false
  }


  function removeBindingUnlessReferenced(b) {
    if (b.referenced) {
      return false
    }
    b.path.remove()
    b.scope.removeOwnBinding(b.identifier.name)
    return true
  }


  const visitor = {

    CallExpression(path) {
      const meta = {}
      if (isEmptyFunction(path.scope, path.node.callee, meta)) {
        if (meta.binding) {
          meta.binding.dereference()
          removeBindingUnlessReferenced(meta.binding)
        }
        path.replaceWith(t.identifier('undefined'))
      }
    },

    FunctionDeclaration(path) {
      if (this.opts.tspkgConfig.compressNames || !path.node.id) {
        return
      }
      // Unless compressing, convert `function bob()` -> `var bob = function bob()`
      // so that when babel-pkg "modulizes" the names we get
      //   var _$foo$bob = function bob()
      // instead of
      //   function _$foo$bob()
      //
      const node = path.node
      const newId = t.identifier(node.id.name)
      const expr = t.functionExpression(
        newId, node.params, node.body, !!node.generator, !!node.async
      )
      expr.returnType = node.returnType
      expr.typeParameters = node.typeParameters
      path.replaceWith(
        t.variableDeclaration("var", [
          t.variableDeclarator(node.id, expr)
        ])
      )
    },

    ClassDeclaration(path) {
      if (this.opts.tspkgConfig.compressNames || !path.node.id) {
        return
      }
      // Unless compressing, convert `class Bob {}` -> `const Bob = class Bob {}`
      // so that when babel-pkg "modulizes" the names we get
      //   var _$foo$Bob = class Bob {}
      // instead of
      //   class _$foo$bob {}
      //
      const node = path.node
      const newId = t.identifier(node.id.name)
      const expr = t.classExpression(newId, node.superClass, node.body, node.decorators || [])
      expr.implements = node.implements
      expr.mixins = node.mixins
      expr.superTypeParameters = node.superTypeParameters
      expr.typeParameters = node.typeParameters
      path.replaceWith(
        t.variableDeclaration("const", [
          t.variableDeclarator(node.id, expr)
        ])
      )
    },

    ExpressionStatement(path) {
      const { scope, node } = path;
      const meta = {}
      if (node.expression.callee && isEmptyFunction(scope, node.expression.callee, meta)) {
        if (meta.binding) {
          meta.binding.dereference()
          removeBindingUnlessReferenced(meta.binding)
        }
        removeOrVoid(path)
      }
    },

    Identifier(path) {
      // constant folding of trivial literals
      if (!t.isExpression(path.parent)) {
        return
      }
      const name = path.node.name
      const b = path.scope.getBinding(name)
      if (b && b.constant && !b.path.removed && t.isVariableDeclarator(b.path)) {
        const init = b.path.node.init
        if (t.isLiteral(init) || t.isIdentifier()) {
          path.replaceWith(init)
          b.dereference()
          removeBindingUnlessReferenced(b)
        }
      }
    },

  }


  return {
    name: "minify",
    visitor: {
      Program(path) {
        const cfg = this.opts.tspkgConfig
        if (cfg.verbose > 1) {
          console.time(`[minify] ${this.file.opts.sourceFileName}`)
        }

        path.traverse(visitor, this);

        function fixRemovedPath(path) {
          if (path.removed) {
            return path
          }
          if (path.parentPath) {
            const removedPath = fixRemovedPath(path.parentPath)
            if (removedPath && !path.removed) {
              path.remove()
            }
            return removedPath
          }
          return null
        }

        // Cleanup bindings which have had been removed
        for (const name of Object.keys(path.scope.bindings)) {
          const b = path.scope.bindings[name]
          if (b.referenced) {
            for (const refpath of b.referencePaths) {
              const removedPath = fixRemovedPath(refpath)
              if (removedPath && b.referenced) {
                // found removed path still being referenced
                b.dereference()
              }
            }
          }

          if (!b.referenced) {
            // caused binding deref -- removing from scope
            b.scope.removeOwnBinding(name)
          }
        }

        if (cfg.verbose > 1) {
          console.timeEnd(`[minify] ${this.file.opts.sourceFileName}`)
        }
      },
    },
  };
};
