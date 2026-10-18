import { createHash } from 'node:crypto';
export const DEPENDENCY_GRAPH_BYPASS_GATE_SCHEMA_ID = 'atm.dependencyGraphBypassGate.v1';
export function compileDependencyGraphBypassGate(input) {
    const normalized = normalize(input);
    const diagnostics = [];
    const nodeSet = new Set(normalized.graph.nodes);
    if (!normalized.authority.sealed || !normalized.authority.digest || normalized.observedAuthorityDigest !== normalized.authority.digest) {
        diagnostics.push('authority-digest-mismatch');
    }
    for (const interfaceId of normalized.graph.publicInterfaces) {
        if (!nodeSet.has(interfaceId))
            diagnostics.push(`unknown-public-interface:${interfaceId}`);
    }
    for (const [from, to] of [...normalized.graph.edges, ...normalized.graph.forbiddenEdges]) {
        if (!nodeSet.has(from))
            diagnostics.push(`unknown-node:${from}`);
        if (!nodeSet.has(to))
            diagnostics.push(`unknown-node:${to}`);
    }
    const forbidden = new Set(normalized.graph.forbiddenEdges.map(edgeKey));
    const violations = normalized.graph.edges
        .filter((edge) => forbidden.has(edgeKey(edge)))
        .map((edge) => `forbidden-edge:${edgeKey(edge)}`);
    const edgeSet = new Set(normalized.graph.edges.map(edgeKey));
    for (const [from, to] of normalized.graph.edges) {
        for (const publicInterface of normalized.graph.publicInterfaces) {
            if (from === publicInterface || to === publicInterface)
                continue;
            if (edgeSet.has(edgeKey([from, publicInterface])) && edgeSet.has(edgeKey([publicInterface, to]))) {
                violations.push(`public-interface-bypass:${from}->${publicInterface}->${to}`);
            }
        }
    }
    if (violations.some((violation) => violation.startsWith('forbidden-edge:')))
        diagnostics.push('forbidden-edge');
    if (violations.some((violation) => violation.startsWith('public-interface-bypass:')))
        diagnostics.push('public-interface-bypass');
    const status = diagnostics.some((entry) => entry.startsWith('unknown-'))
        ? 'contradictory'
        : diagnostics.includes('authority-digest-mismatch')
            ? 'stale'
            : diagnostics.length > 0
                ? 'blocked'
                : 'proven';
    const result = {
        schemaId: DEPENDENCY_GRAPH_BYPASS_GATE_SCHEMA_ID,
        specVersion: '0.1.0',
        runId: normalized.runId,
        authority: normalized.authority,
        observedAuthorityDigest: normalized.observedAuthorityDigest,
        graph: normalized.graph,
        violations: uniqueSorted(violations),
        status,
        diagnostics: uniqueSorted(diagnostics),
        resultDigest: ''
    };
    return { ...result, resultDigest: digest(result) };
}
export const createDependencyGraphBypassGate = compileDependencyGraphBypassGate;
export function replayDependencyGraphBypassGate(result) {
    return compileDependencyGraphBypassGate({
        runId: result.runId,
        authority: result.authority,
        observedAuthorityDigest: result.observedAuthorityDigest,
        ...result.graph
    });
}
export function validateDependencyGraphBypassGate(result) {
    const replay = replayDependencyGraphBypassGate(result);
    const diagnostics = [...result.diagnostics];
    if (replay.resultDigest !== result.resultDigest)
        diagnostics.push('result-digest-mismatch');
    if (replay.status !== result.status)
        diagnostics.push('result-status-mismatch');
    return { ok: diagnostics.length === 0 && result.status === 'proven', diagnostics: uniqueSorted(diagnostics) };
}
function normalize(input) {
    const normalizeEdges = (edges) => (edges ?? []).map(([from, to]) => [String(from).trim(), String(to).trim()])
        .sort(([leftFrom, leftTo], [rightFrom, rightTo]) => edgeKey([leftFrom, leftTo]).localeCompare(edgeKey([rightFrom, rightTo])));
    return {
        runId: String(input.runId ?? '').trim(),
        authority: {
            authorityId: String(input.authority?.authorityId ?? '').trim(),
            digest: String(input.authority?.digest ?? '').trim(),
            sealed: true
        },
        observedAuthorityDigest: String(input.observedAuthorityDigest ?? '').trim(),
        graph: {
            nodes: uniqueSorted((input.nodes ?? []).map((node) => String(node).trim())),
            edges: normalizeEdges(input.edges),
            forbiddenEdges: normalizeEdges(input.forbiddenEdges),
            publicInterfaces: uniqueSorted((input.publicInterfaces ?? []).map((node) => String(node).trim()))
        }
    };
}
function edgeKey([from, to]) { return `${from}->${to}`; }
function uniqueSorted(values) { return [...new Set(values)].sort(); }
function digest(value) { return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
