export function buildDependencyGraph(members: any[] = [], edges: any[] = []) {
  const graph = new Map();
  for (const member of members) {
    const atomId = typeof member === 'string' ? member : member.atomId;
    if (atomId) {
      graph.set(atomId, []);
    }
  }
  for (const edge of edges) {
    const from = edge.from;
    const to = edge.to;
    if (!from || !to) {
      continue;
    }
    if (!graph.has(from)) {
      graph.set(from, []);
    }
    if (!graph.has(to)) {
      graph.set(to, []);
    }
    graph.get(from).push(to);
  }
  return graph;
}

export function detectCycles(graph: any) {
  const indexByNode = new Map();
  const lowLinkByNode = new Map();
  const stack: any[] = [];
  const stacked = new Set();
  const cycles: any[] = [];
  let index = 0;

  function visit(node: any) {
    indexByNode.set(node, index);
    lowLinkByNode.set(node, index);
    index += 1;
    stack.push(node);
    stacked.add(node);

    for (const target of graph.get(node) ?? []) {
      if (!indexByNode.has(target)) {
        visit(target);
        lowLinkByNode.set(node, Math.min(lowLinkByNode.get(node), lowLinkByNode.get(target)));
        continue;
      }
      if (stacked.has(target)) {
        lowLinkByNode.set(node, Math.min(lowLinkByNode.get(node), indexByNode.get(target)));
      }
    }

    if (lowLinkByNode.get(node) !== indexByNode.get(node)) {
      return;
    }

    const component: any[] = [];
    let current = null;
    do {
      current = stack.pop();
      stacked.delete(current);
      component.push(current);
    } while (current !== node);

    if (component.length > 1 || (graph.get(node) ?? []).includes(node)) {
      cycles.push(component.sort());
    }
  }

  for (const node of graph.keys()) {
    if (!indexByNode.has(node)) {
      visit(node);
    }
  }
  return cycles;
}

export function validateDependencyGraph(mapFixture: any, options: any = {}) {
  const graph = buildDependencyGraph(mapFixture.members ?? [], mapFixture.edges ?? []);
  const cycles = detectCycles(graph);
  const violations = cycles.map((cycle) => ({
    code: 'ATM_POLICE_DEPENDENCY_CYCLE',
    severity: 'error',
    message: `Atomic dependency graph contains a cycle: ${cycle.join(' -> ')}`,
    atomId: cycle[0]
  }));
  return {
    checkId: options.checkId ?? 'dependency-graph',
    kind: 'dependency-graph',
    required: true,
    description: options.description ?? 'Validate Atomic Map dependency graph is acyclic.',
    ok: violations.length === 0,
    violations,
    graph: Object.fromEntries([...graph.entries()])
  };
}
