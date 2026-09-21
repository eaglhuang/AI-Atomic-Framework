import { createHash } from 'node:crypto';
export function inferLinkedSurfaceClosure(input) {
    const roots = uniqueSorted(input.rootScope.map(normalizePath));
    const registered = new Set(input.registeredProducerIds);
    const known = new Set(roots);
    const required = new Set();
    const optional = new Set();
    const unavailable = new Set();
    const findings = [];
    const traversalOrder = [];
    const edges = [...input.edges].sort((left, right) => left.edgeId.localeCompare(right.edgeId));
    let changed = true;
    while (changed) {
        changed = false;
        for (const edge of edges) {
            const normalizedInputs = edge.inputs.map(normalizePath);
            const normalizedOutputs = edge.outputs.map(normalizePath);
            if (!normalizedInputs.some((surface) => known.has(surface)))
                continue;
            if (traversalOrder.includes(edge.edgeId)) {
                findings.push(cycleFinding(edge));
                continue;
            }
            traversalOrder.push(edge.edgeId);
            if (!registered.has(edge.producerId)) {
                for (const output of normalizedOutputs) {
                    unavailable.add(output);
                    findings.push({
                        code: 'ATM_LINKED_SURFACE_UNSUPPORTED',
                        surface: output,
                        edgeId: edge.edgeId,
                        producerId: edge.producerId,
                        message: 'Linked surface producer is not registered; scope closure must emit an unsupported receipt instead of inferring by filename convention.'
                    });
                }
                continue;
            }
            for (const output of normalizedOutputs) {
                if (edge.availability === 'required') {
                    required.add(output);
                    if (!known.has(output)) {
                        known.add(output);
                        changed = true;
                    }
                    findings.push({
                        code: 'ATM_SCOPE_AMENDMENT_REQUIRED',
                        surface: output,
                        edgeId: edge.edgeId,
                        producerId: edge.producerId,
                        message: 'Required linked surface must be added to the task scope and broker write set before write admission.'
                    });
                }
                else {
                    optional.add(output);
                    findings.push({
                        code: 'ATM_LINKED_SURFACE_OPTIONAL',
                        surface: output,
                        edgeId: edge.edgeId,
                        producerId: edge.producerId,
                        message: 'Optional linked surface is reported for operator awareness but does not widen scope automatically.'
                    });
                }
            }
        }
    }
    return {
        schemaId: 'atm.linkedSurfaceClosure.v1',
        specVersion: '0.1.0',
        rootScope: roots,
        requiredSurfaces: uniqueSorted([...required]),
        optionalSurfaces: uniqueSorted([...optional].filter((surface) => !required.has(surface))),
        unavailableSurfaces: uniqueSorted([...unavailable]),
        traversalOrder: uniqueSorted(traversalOrder),
        closureDigest: digest({ roots, required: [...required], optional: [...optional], unavailable: [...unavailable], traversalOrder }),
        findings: stableFindings(findings)
    };
}
export function rearbitrateLinkedSurfaceScope(input) {
    const readSet = new Set(input.ticketReadSet.map(normalizePath));
    const writeSet = new Set(input.ticketWriteSet.map(normalizePath));
    const missingReadSet = input.closure.requiredSurfaces.filter((surface) => !readSet.has(surface));
    const missingWriteSet = input.closure.requiredSurfaces.filter((surface) => !writeSet.has(surface));
    return {
        schemaId: 'atm.scopeAmendmentRearbitration.v1',
        required: missingReadSet.length > 0 || missingWriteSet.length > 0,
        errorCode: missingReadSet.length > 0 || missingWriteSet.length > 0 ? 'ATM_BROKER_REARBITRATION_REQUIRED' : null,
        missingReadSet,
        missingWriteSet,
        amendedReadSet: uniqueSorted([...readSet, ...input.closure.requiredSurfaces]),
        amendedWriteSet: uniqueSorted([...writeSet, ...input.closure.requiredSurfaces]),
        closureDigest: input.closure.closureDigest
    };
}
function cycleFinding(edge) {
    return {
        code: 'ATM_LINKED_SURFACE_CYCLE',
        surface: edge.outputs.map(normalizePath).join(','),
        edgeId: edge.edgeId,
        producerId: edge.producerId,
        message: 'Linked surface traversal encountered a previously visited edge; deterministic ordering prevents infinite expansion.'
    };
}
function stableFindings(findings) {
    return [...findings].sort((left, right) => [
        left.code.localeCompare(right.code),
        left.surface.localeCompare(right.surface),
        (left.edgeId ?? '').localeCompare(right.edgeId ?? '')
    ].find((value) => value !== 0) ?? 0);
}
function normalizePath(value) {
    return value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '').trim();
}
function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function digest(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}
function canonicalize(value) {
    if (!value || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return value.map(canonicalize);
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
}
