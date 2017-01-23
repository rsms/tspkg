# tspkg

Creates small, fast and easily-distributable packages from TypeScript projects.

- Conventions over configuration — "just works" with existing TypeScript projects
- Advanced dead-code elimination
- Constant folding
- Import/export elimination
- Eliding or elimination of package-internal modules

Example of constant-folding & DCE working together:

input.ts:

```ts
const DEBUG = 0
const assert = DEBUG ? equal : require('assert')
function a(x :any) {
  assert(x > 0,1)
  return 1 / x
}
```

output.js (from `tspkg -O`; pretty-printed for readability):

```js
function a(x) {
  return 1 / x;
}
```

output.js (from `tspkg -g`; pretty-printed for readability):

```js
const assert = require('assert')
function a(x) {
  assert(x > 0,1)
  return 1 / x;
}
```

## Acyclic dependency graph

tspkg enforces [dependency graphs](https://en.wikipedia.org/wiki/Dependency_graph) to be [acyclic](https://en.wikipedia.org/wiki/Directed_acyclic_graph).
[Circular dependencies](https://en.wikipedia.org/wiki/Circular_dependency#Problems_of_circular_dependencies) leads to error-prone and indeterministic programs, and makes code reuse harder.

Say we have the following dependency graph for an imaginary project that receives
some messages over the network and autmatically replies to them, sometimes via email (SMTP):

<img src="https://cdn.rawgit.com/rsms/tspkg/master/misc/example1-acyclic.svg" width="256">

Now, say we're working on `fmtmsg` and we realize that by using functionality in `msg/parse` we can save ourselves some code-writing. Perhaps `msg/parse` provides a helpful function for folding HTML into plain text. Not knowing that `msg/parse` depends on `msg/classify` which in turn depends on `fmtmsg`, we import `msg/parse` and suddenly Weird Things™ starts happening, like sometimes when we run our program the module-constant "foo" is "1", but sometimes it's "2".

<img src="https://cdn.rawgit.com/rsms/tspkg/master/misc/example1-cyclic.svg" width="256">

tspkg will detect these situations and stop you from building Weird Packages™. Trying to build a package with the above configuration would make tspkg stop with an error:

```txt
error TSPKG1: Circular dependency: msg/parse -> msg/classify -> fmtmsg -> msg/parse
```

We can fix this by moving the helpful function found in `msg/parse` to a separate module/file:

<img src="https://cdn.rawgit.com/rsms/tspkg/master/misc/example1-acyclic2.svg" width="256">


## CLI synopsis

```txt
Usage: ./tspkg [options] [<srcpath>]
options:
  -h[elp]               Show description and detailed help for this program.
  -o[output]=<outfile>  Filename prefix for output(s). E.g. 'a/b' => 'a/b.js'.
                        If not provided, "<srcpath>/<pkgname>" is used when
                        <srcpath> is a directory. Otherwise the file extension
                        of <srcpath> is replaced with ".o".
  -p[kg]=<pkgname>      Name to be used for package when exported globally
                        (i.e. when there's no package management.) If not
                        provided, <pkgname> is inferred from <srcpath>.
  -O                    Produce optimized output. See -help for details.
  -g                    Produce debuggable output. See -help for details.
  -w[atch]              Watch input files and recompile as they change.
  -compress=<bool>      Explicitly enable or disable compression of generated
                        code. Defaults to "true" if -O is provided, otherwise
                        defaults to "false".
  -ts-disable           Ignore and do not attempt to interpret the project as
                        a TypeScript project.
  -ts-options=<json>    Apply <json> to TypeScript "compilerOptions" object.
  -map-root=<dir>       Source map "sourceRoot" value. Inferred from <srcpath>
                        and <outfile> by default.
  -no-maps              Do not read nor write any source maps.
  -v[erbose]            Print details to stdout.
  -debug                Print lots of details to stdout. Implies -v.
  -dry                  Just print the configuration and exit.


<srcpath>
  Either a single javascript file or the path to a directory containing
  package source. If omitted, the current working directory is used.

<outfile>
  A filename prefix that is joined by type suffix for each output file
  produced. For a TypeScript project with declaration files, -o=a/b would
  create the following files:
    a/b.js       Code
    a/b.js.map   Source map
    a/b.d.ts     Type declarations

-g
  When provided:
  • Compression is disabled by default (pass -compress=true to explicitly
    enable).
  • All instances of `const DEBUG = <constlit>` are changed to replace
    `<constlit>` with `true`. This can be used to gate debugging code.

-O
  When provided:
  • Enables optimizations (dead-code elimination, constant folding, etc.)
  • Enables compression (pass -compress=false to explicitly disable.)
  • Unless -g is provided, all instances of `const DEBUG = <constlit>` are
    changed to replace `<constlit>` with `false`. This can be used to have
    debugging code stripped from the generated code, since constant folding
    together with dead-code elimination should remove code gated on "DEBUG".

  When neither -g or -O is provided, the goal of tspkg is to generate output
  as quickly as possible.

  Example of DEBUG elimination; in.js:

    const DEBUG = 0
    const assert = DEBUG ? require('assert') : function(){}
    export function bob(x) {
      assert(x > 0)
      return 4 / x
    }

  tspkg -g in.js  # => out.js:

    const DEBUG = 1
    const assert = DEBUG ? require('assert') : function(){}
    exports.bob = function bob(x) {
      return 4 / x
    }

  tspkg -O in.js  # => out.js:

    exports.bob=function(x){return 4/x};

  Note: Not providing -g or -O would yield code that's functionally identical
  to the in.js example above.
```
