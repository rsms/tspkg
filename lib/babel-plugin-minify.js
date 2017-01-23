// folds expressions using constants, elimintates calls to empty functions, does DCE and CF.
"use strict";
const inspect = require('util').inspect;

// function dump(val, depth, showHidden) {
//   console.log(inspect(val, {colors:true, depth, showHidden}));
// }

module.exports = ({ types: t }) => {
  const removeOrVoid = require("babel-helper-remove-or-void")(t);

  function scopeFind(scope, name) { // : Binding
    let target = scope.globals[name];
    if (target) {
      // console.log(`scopeFind "${name}": found global`);
      return target;
    }
    if ((target = scope.bindings[name])) {
      // console.log(`scopeFind "${name}": found in bindings`);
      return target;
    }
    // console.log(`scopeFind "${name}" not found -- trying parent`);
    return scope.parent ? scopeFind(scope.parent, name) : null;
  }


  function isEmptyFunction2(scope, node, depth) {
    if (node._metadata_isEmptyFunction !== undefined) {
      //console.log('[isEmptyFunction2] returning cached value', node._metadata_isEmptyFunction)
      return node._metadata_isEmptyFunction;
    }
    //console.log('[isEmptyFunction2] exploring', inspect(node, {depth:0,colors:true}))
    if (!depth) {
      depth = 0;
    } else if (depth > 1000) {
      return node._metadata_isEmptyFunction = false;
    }
    if (t.isIdentifier(node)) {
      let binding = scopeFind(scope, node.name);
      // console.log(`isEmptyFunction2 binding for: "${node.name}"`);
      if (binding && binding.path && 
          ( isBindingEmptyFunction(binding) ||
            isEmptyFunction2(binding.scope, binding.path.node, depth+1)
          )
         )
      {
        // state.noopBindings.add(binding);
        binding._metadata_X = true;
        return node._metadata_isEmptyFunction = true;
      }
    } else if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) {
      // console.log(`isEmptyFunction2 isFunctionDeclaration`);
      if (node.body && Array.isArray(node.body.body) && node.body.body.length === 0) {
        return node._metadata_isEmptyFunction = true;
      }
    }
    return node._metadata_isEmptyFunction = false;
  }

  function isBindingEmptyFunction(binding) {
    if (binding._metadata_isEmptyFunction !== undefined) {
      return binding._metadata_isEmptyFunction;
    }
    let node = binding.path.node;
    if (binding.constant && t.isVariableDeclarator(node)) {
      // dump(node);
      // dump(binding);
      if (isEmptyFunction2(binding.scope, node.init)) {
        return binding._metadata_isEmptyFunction = true;
      }
    }
    return binding._metadata_isEmptyFunction = false;
  }

  const visitor = {

    CallExpression(path) {
      const { node, scope } = path;
      // console.log('visit CallExpression'); dump(node.callee);
      if (isEmptyFunction2(scope, node.callee)) {
        //console.log('CallExpression isEmptyFunction2!')
        // console.log(Object.keys(t).join(' ')); process.exit(0)
        path.replaceWith(t.identifier('undefined'));
        node._metadata_REMOVED = true;
      }
    },

    ExpressionStatement(path) {
      const { scope, node } = path;
      if (node.expression.callee && isEmptyFunction2(scope, node.expression.callee)) {
        // dump(path)
        // console.log('ExpressionStatement isEmptyFunction2!')
        removeOrVoid(path);
        node._metadata_REMOVED = true;
      }
    },

    Identifier(path) {
      // constant folding of trivial literals
      if (t.isExpression(path.parent) && path.node.name == '_$c$_$lolcat') {
        const name = path.node.name
        const b = path.scope.getBinding(name)
        if (b && b.constant && !b.path.removed && t.isVariableDeclarator(b.path)) {
          const init = b.path.node.init
          if (t.isLiteral(init) || t.isIdentifier()) {
            b.dereference()
            path.replaceWith(init)
            if (!b.referenced) {
              // last reference removed — remove definition and binding
              b.path.remove()
              b.scope.removeOwnBinding(name)
            }
          }
        }
      }
    },

  }


  return {
    name: "minify",
    visitor: {
      Program(path) {
        path.traverse(visitor, this);
      },
    },
  };
};
