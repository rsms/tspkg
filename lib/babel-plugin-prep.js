"use strict";

module.exports = ({ types: t }) => {
  const visitor1 = {
    VariableDeclaration(path, state) {
      const { scope, node } = path;
      if (node.kind == 'const') {
        path.get('declarations').forEach((declaration, i) => {
          let n = declaration.node, replacement
          if (n.init && n.id && (replacement = this.opts.consts.get(n.id.name)) !== undefined) {
            declaration.get('init').replaceWith(Object.assign({}, replacement))
          }
        })
      }
    },
  }

  return {
    name: "tspkg-prep",
    visitor: {
      Program(path, state) {
        // must be applied before other transformers run
        path.traverse(visitor1, this)
      },
    }
  };
};
