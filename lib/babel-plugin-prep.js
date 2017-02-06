"use strict";

const template = require("babel-template")

module.exports = ({ types: t }) => {

  return {
    name: "tspkg-prep",

    pre(file) {
      this.subs = new Map
      //this.didSub = new Set
      for (const [name, code] of this.opts.subs) {
        let expr = null, stmt = null
        if (code) {
          try {
            stmt = template(code)()
          } catch (err) {
            throw new SyntaxError(
              'Invalid <expr> provided to -D' + name + ' (' + err.message + ')'
            )
          }
          if (t.isExpression(stmt)) {
            // TODO: make stmt
            expr = stmt
          } else {
            expr = stmt.expression
          }
        }
        this.subs.set(name, {stmt, expr})
      }
    },

    visitor: {
      Program(path, state) {

        // Replace body-level constants
        path.node.body.forEach((stmt, i) => {
          if (t.isVariableDeclaration(stmt) && stmt.kind == 'const') {
            const stmtPath = path.get('body')[i]
            stmtPath.get('declarations').forEach((declaration, i) => {
              let n = declaration.node, rn
              if (n.init && n.id && (rn = this.subs.get(n.id.name)) !== undefined) {
                const initPath = declaration.get('init')
                if (!rn.expr) {
                  initPath.remove()
                } else {
                  initPath.replaceWith(rn.expr)
                }
                //this.didSub.add(n.id.name)
              }
            })
          }
        }) // body.forEach

        // Add if not replaced
        // for (const [name, expr] of this.subs) {
        //   if (!this.didSub.has(name)) {
        //     path.node.body.unshift(expr.stmt)
        //     // console.log('add sub', name)
        //   }
        // }

      },
    }
  };
};
