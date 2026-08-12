import { createHash } from 'node:crypto';
/**
 * Runner-sync sealed-input and version/selection contract (ATM-GOV-0266 Phase A).
 *
 * This module owns the *data-shaped* half of the runner-sync session policy: the
 * content-addressed sealed-input graph, the runner version requirement/selection
 * types, and the version-selection receipt. It is pure and side-effect free; the
 * session state machine (`runner-sync-session.ts`) composes these types into a
 * durable lifecycle, and the registry (`runner-version-registry.ts`) indexes
 * published versions for selection.
 *
 * Design intent (card acceptance): the aggregate `runnerInputTreeHash` is a
 * *consistency summary*, not the only rebuild key. The `runnerInputGraph` maps
 * schema-declared input segments to package/release-entry outputs with per-node
 * input/output digests, so a runner-affecting commit after the seal can be
 * classified against the affected graph closure rather than forcing a blind
 * full rebuild.
 */
export const RUNNER_VERSION_SELECTION_RECEIPT_SCHEMA = 'atm.runnerVersionSelectionReceipt.v1';
export const RUNNER_INPUT_GRAPH_SCHEMA = 'atm.runnerInputGraph.v1';
/**
 * Canonical runner-sync error codes declared by ATM-GOV-0266. These are modeled
 * as named constants (INV-ATM-009: data-shaped behavior kept out of control
 * flow). Canonical cross-cutting registration in
 * `docs/governance/error-code-registry.json` is a scoped follow-up.
 */
export const RUNNER_SYNC_ERROR_CODES = {
    sealRevalidationRequired: 'ATM_RUNNER_SYNC_SEAL_REVALIDATION_REQUIRED',
    stewardLeaseExpired: 'ATM_RUNNER_SYNC_STEWARD_LEASE_EXPIRED',
    resumeRequired: 'ATM_RUNNER_SYNC_RESUME_REQUIRED',
    coalescedAttributionMissing: 'ATM_RUNNER_SYNC_COALESCED_ATTRIBUTION_MISSING'
};
/**
 * Schema-declared input segments. A runner-affecting change lands in exactly one
 * segment; `nonRunnerAffecting` paths (planning, backlog docs, task ledgers) do
 * not invalidate an otherwise-matching sealed build.
 */
export const RUNNER_INPUT_SEGMENTS = [
    'packages',
    'scripts',
    'templates',
    'schemas',
    'atomicWorkbench',
    'rootConfig'
];
/**
 * Generated runner outputs must never become sealed inputs of the generation
 * that produced them.  Keeping this as declarative path data makes both delta
 * classification and input hashing share the same boundary.
 */
export const RUNNER_GENERATED_OUTPUT_PREFIXES = ['packages/*/dist/'];
export const RUNNER_INPUT_TREE_PATHS = [
    'packages', 'scripts', 'templates', 'schemas', 'atomic_workbench',
    'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'
];
export function isRunnerGeneratedOutputPath(path) {
    const normalized = normalizePath(path);
    return /^packages\/[^/]+\/dist\//.test(normalized);
}
/** Normalize `git ls-tree -z` output before it becomes a sealed-input digest. */
export function filterRunnerInputTreeListing(listing) {
    return listing.split('\0').filter((entry) => {
        const tab = entry.indexOf('\t');
        return tab < 0 || !isRunnerGeneratedOutputPath(entry.slice(tab + 1));
    }).join('\0');
}
/** Prefixes / exact files that map a repo path to a runner input segment. */
const SEGMENT_PREFIXES = [
    { segment: 'packages', test: (p) => p.startsWith('packages/') },
    { segment: 'scripts', test: (p) => p.startsWith('scripts/') },
    { segment: 'templates', test: (p) => p.startsWith('templates/') },
    { segment: 'schemas', test: (p) => p.startsWith('schemas/') },
    { segment: 'atomicWorkbench', test: (p) => p.startsWith('atomic_workbench/') },
    {
        segment: 'rootConfig',
        test: (p) => ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'].includes(p)
    }
];
/** Lifecycle states a selection may resolve to. */
export const TRUSTED_RUNNER_VERSION_LIFECYCLE_STATES = [
    'published',
    'trusted'
];
export function isTrustedRunnerVersionLifecycleState(state) {
    return TRUSTED_RUNNER_VERSION_LIFECYCLE_STATES.includes(state);
}
/** Map a single repo-relative path to its runner input segment, or null. */
export function classifyRunnerPathSegment(path) {
    const normalized = normalizePath(path);
    if (!normalized || isRunnerGeneratedOutputPath(normalized))
        return null;
    for (const entry of SEGMENT_PREFIXES) {
        if (entry.test(normalized))
            return entry.segment;
    }
    return null;
}
/**
 * Classify a set of changed paths into runner-affecting vs non-runner-affecting.
 * A commit that changes only non-runner paths (planning, backlog docs, `.atm`
 * ledgers) may advance HEAD without invalidating a matching sealed build.
 */
export function classifyRunnerAffectingPaths(paths) {
    const runnerAffecting = [];
    const nonRunnerAffecting = [];
    const segments = new Set();
    for (const raw of paths) {
        const normalized = normalizePath(raw);
        if (!normalized)
            continue;
        const segment = classifyRunnerPathSegment(normalized);
        if (segment) {
            runnerAffecting.push(normalized);
            segments.add(segment);
        }
        else {
            nonRunnerAffecting.push(normalized);
        }
    }
    return {
        runnerAffecting: sortedUnique(runnerAffecting),
        nonRunnerAffecting: sortedUnique(nonRunnerAffecting),
        affectedSegments: [...segments].sort((a, b) => a.localeCompare(b))
    };
}
/**
 * Decide whether a sealed build remains valid against the current HEAD. A
 * non-runner-affecting delta is continuous (reuse). A runner-affecting delta
 * returns the affected graph closure and fails closed with
 * `ATM_RUNNER_SYNC_SEAL_REVALIDATION_REQUIRED` — never publish a runner
 * assembled from mixed input generations.
 */
export function evaluateSealContinuity(input) {
    const classification = classifyRunnerAffectingPaths(input.headDeltaPaths);
    if (classification.runnerAffecting.length === 0) {
        return {
            continuous: true,
            revalidationRequired: false,
            errorCode: null,
            affectedClosure: [],
            reason: classification.nonRunnerAffecting.length === 0
                ? 'HEAD matches the sealed source; no delta.'
                : 'HEAD delta touches only non-runner-affecting paths; sealed build remains valid.'
        };
    }
    const knownSegments = new Set(input.graph.nodes.map((node) => node.segment));
    const affectedClosure = classification.affectedSegments.filter((segment) => knownSegments.has(segment));
    const hasUngraphedOwner = classification.affectedSegments.some((segment) => !knownSegments.has(segment));
    return {
        continuous: false,
        revalidationRequired: true,
        errorCode: RUNNER_SYNC_ERROR_CODES.sealRevalidationRequired,
        affectedClosure,
        reason: hasUngraphedOwner
            ? 'Runner-affecting delta has no valid input-graph owner; full graph refresh + rebuild required before publish.'
            : `Runner-affecting delta in segment(s) ${affectedClosure.join(', ')}; rebuild only the affected closure and regenerate the aggregate manifest.`
    };
}
export function computeAggregateInputTreeHash(nodes) {
    const ordered = [...nodes]
        .sort((a, b) => a.segment.localeCompare(b.segment))
        .map((node) => ({ segment: node.segment, inputDigest: node.inputDigest, outputDigest: node.outputDigest }));
    return `sha256:${createHash('sha256').update(JSON.stringify(ordered)).digest('hex')}`;
}
export function buildRunnerVersionSelectionReceipt(requirement, selection, issuedAt, options = {}) {
    const policyVersion = options.policyVersion?.trim();
    const registrySnapshotDigest = options.registrySnapshotDigest?.trim();
    const core = {
        schemaId: RUNNER_VERSION_SELECTION_RECEIPT_SCHEMA,
        specVersion: (policyVersion || registrySnapshotDigest ? '0.2.0' : '0.1.0'),
        requirement: {
            ...requirement,
            requiredSurfaces: sortedUnique(requirement.requiredSurfaces),
            aggregateInputTreeHash: requirement.aggregateInputTreeHash ?? null
        },
        selection: { ...selection, selectedSurfaces: sortedUnique(selection.selectedSurfaces) },
        ...(policyVersion ? { policyVersion } : {}),
        ...(registrySnapshotDigest ? { registrySnapshotDigest } : {})
    };
    const selectionDigest = `sha256:${createHash('sha256').update(JSON.stringify(core)).digest('hex')}`;
    return { ...core, selectionDigest, issuedAt };
}
export function sortedUnique(values) {
    return [...new Set(values.map((v) => normalizePath(v)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
export function normalizePath(value) {
    return String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}
