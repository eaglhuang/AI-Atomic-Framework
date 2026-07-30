import crypto from 'node:crypto';
export function evaluateModuleBoundaries(input) {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const today = input.today ?? generatedAt.slice(0, 10);
    const supported = input.policy.sourceDiscovery.some((adapter) => adapter.adapterId === input.graph.adapterId && adapter.language === input.graph.language);
    const findings = [];
    if (!supported) {
        findings.push({
            code: 'ATM_MODULE_BOUNDARY_UNSUPPORTED_LANGUAGE',
            severity: 'warning',
            message: `No source discovery adapter is declared for ${input.graph.adapterId}/${input.graph.language}.`
        });
    }
    const modules = input.policy.modules;
    const moduleById = new Map(modules.map((module) => [module.id, module]));
    for (const exception of input.policy.exceptions) {
        if (exception.expiresOn < today) {
            findings.push({
                code: 'ATM_MODULE_BOUNDARY_EXPIRED_EXCEPTION',
                severity: 'error',
                fromModule: exception.fromModule,
                toModule: exception.toModule,
                exceptionId: exception.id,
                message: `Boundary exception ${exception.id} expired on ${exception.expiresOn}.`
            });
        }
    }
    const moduleEdges = new Set();
    for (const edge of input.graph.edges) {
        const fromModule = findOwningModule(modules, edge.from);
        const toModule = findOwningModule(modules, edge.to);
        if (!fromModule || !toModule || fromModule.id === toModule.id)
            continue;
        if (hasActiveException(input.policy.exceptions, edge, fromModule.id, toModule.id, today))
            continue;
        moduleEdges.add(`${fromModule.id}->${toModule.id}`);
        if (!isPublicEntrypoint(toModule, edge.to)) {
            findings.push({
                code: 'ATM_MODULE_BOUNDARY_DEEP_IMPORT',
                severity: 'error',
                from: edge.from,
                to: edge.to,
                fromModule: fromModule.id,
                toModule: toModule.id,
                specifier: edge.specifier,
                message: `${fromModule.id} imports non-public file ${edge.to} from ${toModule.id}.`
            });
        }
        if (!isAllowedDependency(fromModule, toModule)) {
            findings.push({
                code: 'ATM_MODULE_BOUNDARY_UNDECLARED_EDGE',
                severity: 'error',
                from: edge.from,
                to: edge.to,
                fromModule: fromModule.id,
                toModule: toModule.id,
                specifier: edge.specifier,
                message: `${fromModule.id} is not declared as an allowed consumer/dependency for ${toModule.id}.`
            });
        }
    }
    for (const cycle of detectCycles(moduleEdges)) {
        findings.push({
            code: 'ATM_MODULE_BOUNDARY_CYCLE',
            severity: 'error',
            cycle,
            message: `Module dependency cycle detected: ${cycle.join(' -> ')}.`
        });
    }
    return {
        schemaId: 'atm.moduleBoundaryValidationReceipt.v1',
        specVersion: '0.1.0',
        ok: findings.every((finding) => finding.severity !== 'error'),
        mode: input.policy.mode,
        generatedAt,
        sourceDigest: input.sourceDigest ?? digestJson(input.graph),
        configDigest: input.configDigest ?? digestJson(input.policy),
        candidateDigest: input.candidateDigest ?? digestJson({ policy: input.policy, graph: input.graph }),
        adapterId: input.graph.adapterId,
        language: input.graph.language,
        unsupportedLanguage: !supported,
        findings,
        observedEdgeCount: input.graph.edges.length
    };
}
export function findOwningModule(modules, filePath) {
    const normalized = normalizePath(filePath);
    const matches = modules
        .filter((module) => module.roots.some((root) => isWithin(normalized, root)))
        .sort((left, right) => longestRoot(right) - longestRoot(left));
    return matches[0] ?? null;
}
export function normalizePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}
function isPublicEntrypoint(module, filePath) {
    const normalized = normalizePath(filePath);
    return module.publicEntrypoints.some((entrypoint) => normalizePath(entrypoint) === normalized);
}
function isAllowedDependency(fromModule, toModule) {
    return (toModule.allowedConsumers.includes('*') ||
        toModule.allowedConsumers.includes(fromModule.id) ||
        (fromModule.allowedDependencies ?? []).includes(toModule.id));
}
function hasActiveException(exceptions, edge, fromModule, toModule, today) {
    return exceptions.some((exception) => {
        if (exception.fromModule !== fromModule || exception.toModule !== toModule)
            return false;
        if (exception.expiresOn < today)
            return false;
        if (!exception.match)
            return true;
        return edge.specifier.includes(exception.match) || normalizePath(edge.to).includes(exception.match);
    });
}
function detectCycles(edgeSet) {
    const adjacency = new Map();
    for (const edge of edgeSet) {
        const [from, to] = edge.split('->');
        if (!adjacency.has(from))
            adjacency.set(from, new Set());
        adjacency.get(from).add(to);
    }
    const cycles = [];
    const visiting = new Set();
    const visited = new Set();
    const visit = (node, path) => {
        if (visiting.has(node)) {
            const start = path.indexOf(node);
            if (start >= 0)
                cycles.push([...path.slice(start), node]);
            return;
        }
        if (visited.has(node))
            return;
        visiting.add(node);
        for (const next of adjacency.get(node) ?? [])
            visit(next, [...path, next]);
        visiting.delete(node);
        visited.add(node);
    };
    for (const node of adjacency.keys())
        visit(node, [node]);
    return dedupeCycles(cycles);
}
function dedupeCycles(cycles) {
    const seen = new Set();
    const output = [];
    for (const cycle of cycles) {
        const key = [...cycle].sort().join('|');
        if (seen.has(key))
            continue;
        seen.add(key);
        output.push(cycle);
    }
    return output;
}
function isWithin(filePath, root) {
    const normalizedRoot = normalizePath(root).replace(/\/$/, '');
    return filePath === normalizedRoot || filePath.startsWith(`${normalizedRoot}/`);
}
function longestRoot(module) {
    return Math.max(...module.roots.map((root) => normalizePath(root).length));
}
function digestJson(value) {
    return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
