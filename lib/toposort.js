"use strict"

class DAG {
  // Note: Insertion order is retained

  constructor() {
    this.nodes = new Map;
    this.dependantsOfMap = new Map;
  }

  // add(from :any, to? :any) :DAG
  add(from_, to) {
    // from -> to
    let v = this.nodes.get(from_);
    if (v) {
      if (to) {
        v.add(to);
      }
    } else {
      if (to) {
        this.nodes.set(from_, new Set([to]));
      } else {
        this.nodes.set(from_, new Set);
      }
    }
    if (to) {
      let v2 = this.dependantsOfMap.get(to)
      if (v2) {
        v2.add(from_)
      } else {
        this.dependantsOfMap.set(to, new Set([from_]))
      }
    }
    return this;
  }

  dependantsOf(dependency) { // :Set
    return this.dependantsOfMap.get(dependency)
  }

  // toposort(onCycleDetected :(dependant :any, dependency :any)=>boolean)
  //   If onCycleDetected returns a truthy value, the cycle is ignored. Otherwise
  //   the sort is interrupted and the sort function returns null.
  toposort(onCycleDetected) {
    // L ← Empty list that will contain the sorted nodes
    // while there are unmarked nodes do
    //     select an unmarked node n
    //     visit(n) 
    // function visit(node n)
    //     if n has a temporary mark then stop (not a DAG)
    //     if n is not marked (i.e. has not been visited yet) then
    //         mark n temporarily
    //         for each node m with an edge from n to m do
    //             visit(m)
    //         mark n permanently
    //         unmark n temporarily
    //         add n to head of L
    const L = []
    const mark = new Map
    const nodes = this.nodes
    const visit = (n, edges, pn) => {
      let m = mark.get(n);
      if (m) {
        if (m === true) {
          return true; // has been visited
        } else {
          return onCycleDetected(n, pn);
        }
      }
      mark.set(n, 1);
      if (edges) {
        edges.forEach(n2 => visit(n2, nodes.get(n2), n));
      }
      mark.set(n, true);
      L.push(n);
      return true
    }

    for (let [k,v] of nodes) {
      if (!visit(k, v)) {
        return null
      }
    }

    return L
  }

  // findPath(from :any, to :any) :any[]
  findPath(from_, to) {
    // TODO: something more efficient
    const findpath = (set, acc) => {
      for (let n of set) {
        // console.log()
        if (n == to) {
          acc.push(n)
          return acc
        }
        const v = this.nodes.get(n)
        if (v) {
          const r = findpath(v, acc.concat([n]))
          if (r) {
            return r
          }
        }
      }
      return null
    }
    return findpath(this.nodes.get(from_), [from_])
  }
  
  toDotString() {
    let lines = []
    const ids = new Map;
    function visit(n, nv) {
      if (ids.has(n)) return;
      ids.set(n, JSON.stringify(String(n)));
    }
    for (let e of this.nodes) {
      visit(e[0]);
      e[1] && e[1].forEach(visit);
    }
    for (let e of this.nodes) {
      let h = '  ' + ids.get(e[0]);
      if (e[1]) {
        h += ' -> ';
        e[1].forEach(n2 => {
          lines.push(h + ids.get(n2))
        });
      } else {
        lines.push(h)
      }
    }
    return lines.join('\n')
  }
}

exports.DAG = DAG
