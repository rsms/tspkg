/* eslint max-len: 0 */
// Copy of https://github.com/babel/babel/tree/master/packages/
//  babel-plugin-transform-es2015-modules-commonjs
// that doesn't generate `(0, foo)` expressions.
"use strict";
exports.__esModule = true;
const { basename, extname } = require("path")
const template = require("babel-template")

const buildRequire = template(`
  require($0);
`);

const buildExportsModuleDeclaration = template(`
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
`);

const buildExportsFrom = template(`
  Object.defineProperty(exports, $0, {
    enumerable: true,
    get: function () {
      return $1;
    }
  });
`);

const buildLooseExportsModuleDeclaration = template(`
  exports.__esModule = true;
`);

const buildExportsAssignment = template(`
  exports.$0 = $1;
`);

const buildExportAll = template(`
  Object.keys(OBJECT).forEach(function (key) {
    if (key === "default" || key === "__esModule") return;
    Object.defineProperty(exports, key, {
      enumerable: true,
      get: function () {
        return OBJECT[key];
      }
    });
  });
`);

const THIS_BREAK_KEYS = ["FunctionExpression", "FunctionDeclaration", "ClassProperty", "ClassMethod", "ObjectMethod"];

module.exports = exports.default = function ({types: t}) {
  const REASSIGN_REMAP_SKIP = Symbol();

  const reassignmentVisitor = {
    ReferencedIdentifier(path) {
      const name = path.node.name;
      const remap = this.remaps[name];
      if (!remap) return;

      // redeclared in this scope
      if (this.scope.getBinding(name) !== path.scope.getBinding(name)) return;

      if (path.parentPath.isCallExpression({ callee: path.node })) {
        //path.replaceWith(t.sequenceExpression([t.numericLiteral(0), remap]));
        path.replaceWith(remap);
      } else if (path.isJSXIdentifier() && t.isMemberExpression(remap)) {
        const { object, property } = remap;
        path.replaceWith(t.JSXMemberExpression(t.JSXIdentifier(object.name), t.JSXIdentifier(property.name)));
      } else {
        path.replaceWith(remap);
      }
      this.requeueInParent(path);
    },

    AssignmentExpression(path) {
      let node = path.node;
      if (node[REASSIGN_REMAP_SKIP]) return;

      const left = path.get("left");
      if (!left.isIdentifier()) return;

      const name = left.node.name;
      const exports = this.exports[name];
      if (!exports) return;

      // redeclared in this scope
      if (this.scope.getBinding(name) !== path.scope.getBinding(name)) return;

      node[REASSIGN_REMAP_SKIP] = true;

      for (const reid of exports) {
        node = buildExportsAssignment(reid, node).expression;
      }

      path.replaceWith(node);
      this.requeueInParent(path);
    },

    UpdateExpression(path) {
      const arg = path.get("argument");
      if (!arg.isIdentifier()) return;

      const name = arg.node.name;
      const exports = this.exports[name];
      if (!exports) return;

      // redeclared in this scope
      if (this.scope.getBinding(name) !== path.scope.getBinding(name)) return;

      const node = t.assignmentExpression(path.node.operator[0] + "=", arg.node, t.numericLiteral(1));

      if ((path.parentPath.isExpressionStatement() && !path.isCompletionRecord()) || path.node.prefix) {
        path.replaceWith(node);
        this.requeueInParent(path);
        return;
      }

      const nodes = [];
      nodes.push(node);

      let operator;
      if (path.node.operator === "--") {
        operator = "+";
      } else { // "++"
        operator = "-";
      }
      nodes.push(t.binaryExpression(operator, arg.node, t.numericLiteral(1)));

      path.replaceWithMultiple(t.sequenceExpression(nodes));
    }
  };

  return {
    // inherits: require("babel-plugin-transform-strict-mode"),

    visitor: {
      ThisExpression(path, state) {
        // If other plugins run after this plugin's Program#exit handler, we allow them to
        // insert top-level `this` values. This allows the AMD and UMD plugins to
        // function properly.
        if (this.ranCommonJS) return;

        if (
          state.opts.allowTopLevelThis !== true &&
          !path.findParent((path) => !path.is("shadow") &&
          THIS_BREAK_KEYS.indexOf(path.type) >= 0)
        ) {
          path.replaceWith(t.identifier("undefined"));
        }
      },

      Program: {
        exit(path) {
          this.ranCommonJS = true;

          const strict = !!this.opts.strict;

          const { scope } = path;

          // rename these commonjs variables if they're declared in the file
          scope.rename("module");
          scope.rename("exports");
          scope.rename("require");

          let hasExports = false;
          let hasImports = false;

          const body /*:Array<Object>*/ = path.get("body");
          const imports = Object.create(null);
          const exports = Object.create(null);

          const nonHoistedExportNames = Object.create(null);

          const topNodes = [];
          const remaps = Object.create(null);

          const requires = Object.create(null);

          function addRequire(source, blockHoist) {
            const cached = requires[source];
            if (cached) return cached;

            const ref = path.scope.generateUidIdentifier(basename(source, extname(source)));

            const varDecl = t.variableDeclaration("const", [
              t.variableDeclarator(ref, buildRequire(
                t.stringLiteral(source)
              ).expression)
            ]);

            // Copy location from the original import statement for sourcemap
            // generation.
            if (imports[source]) {
              varDecl.loc = imports[source].loc;
            }

            if (typeof blockHoist === "number" && blockHoist > 0) {
              varDecl._blockHoist = blockHoist;
            }

            topNodes.push(varDecl);

            return requires[source] = ref;
          }

          function addTo(obj, key, arr) {
            const existing = obj[key] || [];
            obj[key] = existing.concat(arr);
          }

          for (const path of body) {
            if (path.isExportDeclaration()) {
              hasExports = true;

              const specifiers = [].concat(path.get("declaration"), path.get("specifiers"));
              for (const specifier of specifiers) {
                const ids = specifier.getBindingIdentifiers();
                if (ids.__esModule) {
                  throw specifier.buildCodeFrameError("Illegal export \"__esModule\"");
                }
              }
            }

            if (path.isImportDeclaration()) {
              hasImports = true;

              const key = path.node.source.value;
              const importsEntry = imports[key] || {
                specifiers: [],
                maxBlockHoist: 0,
                loc: path.node.loc,
              };

              importsEntry.specifiers.push(...path.node.specifiers);

              if (typeof path.node._blockHoist === "number") {
                importsEntry.maxBlockHoist = Math.max(
                  path.node._blockHoist,
                  importsEntry.maxBlockHoist
                );
              }

              imports[key] = importsEntry;

              path.remove();
            } else if (path.isExportDefaultDeclaration()) {
              const declaration = path.get("declaration");
              if (declaration.isFunctionDeclaration()) {
                const id = declaration.node.id;
                const defNode = t.identifier("default");
                if (id) {
                  addTo(exports, id.name, defNode);
                  topNodes.push(buildExportsAssignment(defNode, id));
                  path.replaceWith(declaration.node);
                } else {
                  topNodes.push(buildExportsAssignment(defNode, t.toExpression(declaration.node)));
                  path.remove();
                }
              } else if (declaration.isClassDeclaration()) {
                const id = declaration.node.id;
                const defNode = t.identifier("default");
                if (id) {
                  addTo(exports, id.name, defNode);
                  path.replaceWithMultiple([
                    declaration.node,
                    buildExportsAssignment(defNode, id)
                  ]);
                } else {
                  path.replaceWith(buildExportsAssignment(defNode, t.toExpression(declaration.node)));

                  // Manualy re-queue `export default class {}` expressions so that the ES3 transform
                  // has an opportunity to convert them. Ideally this would happen automatically from the
                  // replaceWith above. See #4140 for more info.
                  path.parentPath.requeue(path.get("expression.left"));
                }
              } else {
                path.replaceWith(buildExportsAssignment(t.identifier("default"), declaration.node));

                // Manualy re-queue `export default foo;` expressions so that the ES3 transform
                // has an opportunity to convert them. Ideally this would happen automatically from the
                // replaceWith above. See #4140 for more info.
                path.parentPath.requeue(path.get("expression.left"));
              }
            } else if (path.isExportNamedDeclaration()) {
              const declaration = path.get("declaration");
              if (declaration.node) {
                if (declaration.isFunctionDeclaration()) {
                  const id = declaration.node.id;
                  addTo(exports, id.name, id);
                  topNodes.push(buildExportsAssignment(id, id));
                  path.replaceWith(declaration.node);
                } else if (declaration.isClassDeclaration()) {
                  const id = declaration.node.id;
                  addTo(exports, id.name, id);
                  path.replaceWithMultiple([
                    declaration.node,
                    buildExportsAssignment(id, id)
                  ]);
                  nonHoistedExportNames[id.name] = true;
                } else if (declaration.isVariableDeclaration()) {
                  const declarators = declaration.get("declarations");
                  for (const decl of declarators) {
                    const id = decl.get("id");

                    const init = decl.get("init");
                    if (!init.node) init.replaceWith(t.identifier("undefined"));

                    if (id.isIdentifier()) {
                      addTo(exports, id.node.name, id.node);
                      init.replaceWith(buildExportsAssignment(id.node, init.node).expression);
                      nonHoistedExportNames[id.node.name] = true;
                    } else {
                      // todo
                    }
                  }
                  path.replaceWith(declaration.node);
                }
                continue;
              }

              const specifiers = path.get("specifiers");
              const nodes = [];
              const source = path.node.source;
              if (source) {
                const ref = addRequire(source.value, path.node._blockHoist);

                for (const specifier of specifiers) {
                  if (specifier.isExportNamespaceSpecifier()) {
                    // todo
                  } else if (specifier.isExportDefaultSpecifier()) {
                    // todo
                  } else if (specifier.isExportSpecifier()) {
                    if (specifier.node.local.name === "default") {
                      topNodes.push(buildExportsFrom(t.stringLiteral(specifier.node.exported.name), t.memberExpression(t.callExpression(this.addHelper("interopRequireDefault"), [ref]), specifier.node.local)));
                    } else {
                      topNodes.push(buildExportsFrom(t.stringLiteral(specifier.node.exported.name), t.memberExpression(ref, specifier.node.local)));
                    }
                    nonHoistedExportNames[specifier.node.exported.name] = true;
                  }
                }
              } else {
                for (const specifier of specifiers) {
                  if (specifier.isExportSpecifier()) {
                    addTo(exports, specifier.node.local.name, specifier.node.exported);
                    nonHoistedExportNames[specifier.node.exported.name] = true;
                    nodes.push(buildExportsAssignment(specifier.node.exported, specifier.node.local));
                  }
                }
              }
              path.replaceWithMultiple(nodes);
            } else if (path.isExportAllDeclaration()) {
              const exportNode = buildExportAll({
                OBJECT: addRequire(path.node.source.value, path.node._blockHoist)
              });
              exportNode.loc = path.node.loc;
              topNodes.push(exportNode);
              path.remove();
            }
          }

          for (const source in imports) {
            const { specifiers, maxBlockHoist } = imports[source];
            if (specifiers.length) {
              const uid = addRequire(source, maxBlockHoist);

              let wildcard;

              for (let i = 0; i < specifiers.length; i++) {
                const specifier = specifiers[i];
                if (t.isImportNamespaceSpecifier(specifier)) {
                  if (strict) {
                    remaps[specifier.local.name] = uid;
                  } else {
                    const varDecl = t.variableDeclaration("var", [
                      t.variableDeclarator(
                        specifier.local,
                        t.callExpression(
                          this.addHelper("interopRequireWildcard"),
                          [uid]
                        )
                      )
                    ]);

                    if (maxBlockHoist > 0) {
                      varDecl._blockHoist = maxBlockHoist;
                    }

                    topNodes.push(varDecl);
                  }
                  wildcard = specifier.local;
                } else if (t.isImportDefaultSpecifier(specifier)) {
                  specifiers[i] = t.importSpecifier(specifier.local, t.identifier("default"));
                }
              }

              for (const specifier of specifiers) {
                if (t.isImportSpecifier(specifier)) {
                  let target = uid;
                  if (specifier.imported.name === "default") {
                    if (wildcard) {
                      target = wildcard;
                    } else {
                      target = wildcard = path.scope.generateUidIdentifier(uid.name);
                      const varDecl = t.variableDeclaration("var", [
                        t.variableDeclarator(
                          target,
                          t.callExpression(
                            this.addHelper("interopRequireDefault"),
                            [uid]
                          )
                        )
                      ]);

                      if (maxBlockHoist > 0) {
                        varDecl._blockHoist = maxBlockHoist;
                      }

                      topNodes.push(varDecl);
                    }
                  }
                  remaps[specifier.local.name] = t.memberExpression(target, t.cloneWithoutLoc(specifier.imported));
                }
              }
            } else {
              // bare import
              const requireNode = buildRequire(t.stringLiteral(source));
              requireNode.loc = imports[source].loc;
              topNodes.push(requireNode);
            }
          }

          if (hasImports && Object.keys(nonHoistedExportNames).length) {

            // avoid creating too long of export assignment to prevent stack overflow
            const maxHoistedExportsNodeAssignmentLength = 100;
            const nonHoistedExportNamesArr = Object.keys(nonHoistedExportNames);

            for (let currentExportsNodeAssignmentLength = 0;
                 currentExportsNodeAssignmentLength < nonHoistedExportNamesArr.length;
                 currentExportsNodeAssignmentLength += maxHoistedExportsNodeAssignmentLength )
            {
              const nonHoistedExportNamesChunk = nonHoistedExportNamesArr.slice(currentExportsNodeAssignmentLength, currentExportsNodeAssignmentLength + maxHoistedExportsNodeAssignmentLength);

              let hoistedExportsNode = t.identifier("undefined");

              nonHoistedExportNamesChunk.forEach(function (name) {
                hoistedExportsNode = buildExportsAssignment(t.identifier(name), hoistedExportsNode).expression;
              });

              const node = t.expressionStatement(hoistedExportsNode);
              node._blockHoist = 3;

              topNodes.unshift(node);
            }
          }

          // add __esModule declaration if this file has any exports
          if (hasExports && !strict) {
            let buildTemplate = buildExportsModuleDeclaration;
            if (this.opts.loose) buildTemplate = buildLooseExportsModuleDeclaration;

            const declar = buildTemplate();
            declar._blockHoist = 3;

            topNodes.unshift(declar);
          }

          path.unshiftContainer("body", topNodes)

          path.traverse(reassignmentVisitor, {
            remaps,
            scope,
            exports,
            requeueInParent: (newPath) => path.requeue(newPath),
          });
        }
      }
    }
  };
}