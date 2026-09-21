function asMemberRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function asEdgeRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
export function buildDependencyGraph(members = [], edges = []) {
    const graph = new Map();
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
export function detectCycles(graph) {
    const indexByNode = new Map();
    const lowLinkByNode = new Map();
    const stack = [];
    const stacked = new Set();
    const cycles = [];
    let index = 0;
    function visit(node) {
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
        const component = [];
        let current;
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
export function validateDependencyGraph(mapFixture, options = {}) {
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
