// TASK-RFT-0013 — extracted verbatim from packages/cli/src/commands/tasks.ts.
// Broker admission explanation cluster: builds structured explanations of
// Broker adapter admission verdicts for the parallel advisor / close path.
export function buildBrokerAdmissionExplanation(input) {
    const adapterExplanations = input.overlappingFiles.flatMap((filePath) => explainBrokerAdapterForPath(filePath));
    const needsMutationIntent = input.overlappingAtomIds.length > 0
        || adapterExplanations.some((entry) => entry.mutationIntentStatus === 'missing');
    return {
        schemaId: 'atm.brokerAdmissionExplanation.v1',
        authority: 'broker-conflict-engine',
        confirmedConflict: false,
        mutationIntentStatus: needsMutationIntent ? 'missing' : 'not-required',
        reason: needsMutationIntent
            ? 'Task metadata exposes overlapping ownership or shared non-code surfaces, but no Broker mutation request / conflict key is available. Admission must not present this as a confirmed CID conflict.'
            : 'No Broker mutation conflict evidence is required for this pair.',
        conflictKeys: [],
        adapterExplanations
    };
}
export function explainBrokerAdapterForPath(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized === 'atomic_workbench/atomization-coverage/path-to-atom-map.json') {
        return [{
                filePath: normalized,
                adapterId: 'path-to-atom-map',
                conflictSurface: 'projection',
                mutationIntentStatus: 'missing',
                reason: 'path-to-atom-map.json is a derived projection. Row-level conflict keys require owner-shard mutation targets, not the projection file alone.',
                canonicalPathHint: 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-*.json'
            }];
    }
    if (/atomic_workbench\/atomization-coverage\/path-to-atom-map-shards\/owner-shard-[^/]+\.json$/.test(normalized)) {
        return [{
                filePath: normalized,
                adapterId: 'path-to-atom-map',
                conflictSurface: 'owner-shard',
                mutationIntentStatus: 'missing',
                reason: 'Owner-shard path is adapter-aware, but task ledgers do not declare the row mutation target (path_pattern::atom_id), so the Broker cannot confirm a row conflict at claim time.'
            }];
    }
    if (normalized.endsWith('.scalars.json') || normalized.endsWith('.counter.json')) {
        return [{
                filePath: normalized,
                adapterId: 'numeric-scalar',
                conflictSurface: 'scalar',
                mutationIntentStatus: 'missing',
                reason: 'Scalar JSON can be adapter-merged only when mutation requests declare the scalar target and operation.'
            }];
    }
    if (normalized.endsWith('.json')) {
        return [{
                filePath: normalized,
                adapterId: 'json-record',
                conflictSurface: 'json-record',
                mutationIntentStatus: 'missing',
                reason: 'JSON record conflicts require JSON pointer mutation targets; task file scope alone is insufficient.'
            }];
    }
    if (normalized.endsWith('.md') || normalized.endsWith('.txt')) {
        return [{
                filePath: normalized,
                adapterId: 'text-range',
                conflictSurface: 'text-range',
                mutationIntentStatus: 'missing',
                reason: 'Text conflicts require line-range or anchor mutation targets; task file scope alone is insufficient.'
            }];
    }
    return [];
}
export function hasUnexplainedSharedProjection(sharedProjections, brokerAdmission) {
    return sharedProjections.some((projection) => {
        const normalized = projection.replace(/\\/g, '/');
        return !brokerAdmission.adapterExplanations.some((entry) => entry.filePath === normalized);
    });
}
