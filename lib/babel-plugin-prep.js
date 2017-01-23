"use strict";

module.exports = ({ types: t }) => {
  return {
    name: "tspkg-prep",
    visitor: {
      Program(path, state) {
        if (state.opts && state.opts.consts) {
          state.constmap = new Map()
          for (let k in state.opts.consts) {
            state.constmap.set(k, state.opts.consts[k])
          }
        }
      },

      VariableDeclaration(path, state) {
        const { scope, node } = path;
        if (node.kind == 'const') {
          for (let declaration of node.declarations) {
            if (declaration.init && declaration.id) {
              const name = declaration.id.name
              if (state.constmap.has(name)) {
                declaration.init = state.constmap.get(name)
              }
            }
          }
        }
      },
    }
  };
};
