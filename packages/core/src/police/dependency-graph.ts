interface GraphMemberRecord {
  readonly atomId?: string;
}

interface GraphEdgeRecord {
  readonly from?: string;
  readonly to?: string;
}

interface DependencyMapFixture {
  readonly members?: unknown[];
  readonly edges?: unknown[];
}

interface DependencyGraphValidationOptions {
  readonly checkId?: string;
  readonly description?: string;
}

function asMemberRecord(value: unknown): GraphMemberRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as GraphMemberRecord
    : null;
}

function asEdgeRecord(value: unknown): GraphEdgeRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as GraphEdgeRecord
    : null;
}

export function buildDependencyGraph(members: unknown[] = [], edges: unknown[] = []) {
  const graph = new Map<string, string[]>();
  for (const member of members) {
    const atomId = typeof member === 'string' ? member : asMemberRecord(member)?.atomId;
    if (atomId) {
      graph.set(atomId, []);
    }
  }
  for (const edge of edges) {
    const edgeRecord = asEdgeRecord(edge);
    const from = edgeRecord?.from;
    const to = edgeRecord?.to;
    if (!from || !to) {
      continue;
    }
    if (!graph.has(from)) {
      graph.set(from, []);
    }
    if (!graph.has(to)) {
      graph.set(to, []);
    }
    graph.get(from)?.push(to);
  }
  return graph;
}

export function detectCycles(graph: Map<string, string[]>) {
  const indexByNode = new Map<string, number>();
  const lowLinkByNode = new Map<string, number>();
  const stack: string[] = [];
  const stacked = new Set<string>();
  const cycles: string[][] = [];
  let index = 0;

  function visit(node: string) {
    indexByNode.set(node, index);
    lowLinkByNode.set(node, index);
    index += 1;
    stack.push(node);
    stacked.add(node);

    for (const target of graph.get(node) ?? []) {
      if (!indexByNode.has(target)) {
        visit(target);
        const currentLowLink = lowLinkByNode.get(node);
        const targetLowLink = lowLinkByNode.get(target);
        if (currentLowLink != null && targetLowLink != null) {
          lowLinkByNode.set(node, Math.min(currentLowLink, targetLowLink));
        }
        continue;
      }
      if (stacked.has(target)) {
        const currentLowLink = lowLinkByNode.get(node);
        const targetIndex = indexByNode.get(target);
        if (currentLowLink != null && targetIndex != null) {
          lowLinkByNode.set(node, Math.min(currentLowLink, targetIndex));
        }
      }
    }

    if (lowLinkByNode.get(node) !== indexByNode.get(node)) {
      return;
    }

    const component: string[] = [];
    let current: string | undefined;
    do {
      current = stack.pop();
      if (!current) {
        break;
      }
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

export function validateDependencyGraph(mapFixture: DependencyMapFixture, options: DependencyGraphValidationOptions = {}) {
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
