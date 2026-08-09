import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyCanonicalSiblingPreference, isDerivativeSiblingRepoName, PLANNING_ROOT_AMBIGUOUS_CODE, resolveCandidatePlanningRoots, selectPlanningRoot } from '../planning-root-preference.js';
function fakeReadDir(parentDir, names) {
    return (directoryPath) => {
        if (path.resolve(directoryPath) !== path.resolve(parentDir))
            return [];
        return names.map((name) => ({
            name,
            isDirectory: () => true,
            isFile: () => false
        }));
    };
}
assert.equal(isDerivativeSiblingRepoName('PlanningCanonical', 'PlanningCanonical-captain-dispatch-push'), true);
assert.equal(isDerivativeSiblingRepoName('PlanningCanonical', 'PlanningCanonical'), false);
assert.equal(isDerivativeSiblingRepoName('PlanningCanonical-captain-dispatch-push', 'PlanningCanonical'), false);
const sandbox = mkdtempSync(path.join(tmpdir(), 'planning-root-preference-'));
try {
    const aafRepo = path.join(sandbox, 'AI-Atomic-Framework');
    const canonical = path.join(sandbox, 'PlanningCanonical');
    const stale = path.join(sandbox, 'PlanningCanonical-captain-dispatch-push');
    for (const repo of [aafRepo, canonical, stale]) {
        mkdirSync(path.join(repo, 'docs', 'ai_atomic_framework'), { recursive: true });
        writeFileSync(path.join(repo, 'docs', 'ai_atomic_framework', 'marker.txt'), 'ok', 'utf8');
    }
    const resolution = resolveCandidatePlanningRoots(aafRepo, {
        readDir: fakeReadDir(path.dirname(aafRepo), ['AI-Atomic-Framework', 'PlanningCanonical', 'PlanningCanonical-captain-dispatch-push']),
        exists: existsSync
    });
    assert.ok(resolution.roots.some((entry) => entry.startsWith(`${canonical}${path.sep}`)));
    assert.equal(resolution.roots.some((entry) => entry.startsWith(`${stale}${path.sep}`)), false, 'derivative sibling planning root must be excluded when canonical exists');
    assert.ok(resolution.excludedDerivativeRoots.some((entry) => entry.startsWith(`${stale}${path.sep}`)));
    const ambiguousSandbox = mkdtempSync(path.join(tmpdir(), 'planning-root-ambiguous-'));
    try {
        const ambiguousRepo = path.join(ambiguousSandbox, 'AI-Atomic-Framework');
        mkdirSync(path.join(ambiguousRepo, 'docs', 'ai_atomic_framework'), { recursive: true });
        mkdirSync(path.join(ambiguousSandbox, 'PlanningPrefix-foo', 'docs', 'ai_atomic_framework'), { recursive: true });
        mkdirSync(path.join(ambiguousSandbox, 'PlanningPrefix-bar', 'docs', 'ai_atomic_framework'), { recursive: true });
        writeFileSync(path.join(ambiguousRepo, 'docs', 'ai_atomic_framework', 'marker.txt'), 'ok', 'utf8');
        writeFileSync(path.join(ambiguousSandbox, 'PlanningPrefix-foo', 'docs', 'ai_atomic_framework', 'marker.txt'), 'ok', 'utf8');
        writeFileSync(path.join(ambiguousSandbox, 'PlanningPrefix-bar', 'docs', 'ai_atomic_framework', 'marker.txt'), 'ok', 'utf8');
        const ambiguousResolution = resolveCandidatePlanningRoots(ambiguousRepo, {
            readDir: fakeReadDir(path.dirname(ambiguousRepo), ['AI-Atomic-Framework', 'PlanningPrefix-foo', 'PlanningPrefix-bar']),
            exists: existsSync
        });
        assert.equal(ambiguousResolution.warnings.length, 1);
        assert.equal(ambiguousResolution.warnings[0]?.code, 'ATM_PLANNING_ROOT_AMBIGUOUS');
        assert.deepEqual([...ambiguousResolution.warnings[0]?.siblingRepoDirs ?? []].sort(), ['PlanningPrefix-bar', 'PlanningPrefix-foo']);
    }
    finally {
        rmSync(ambiguousSandbox, { recursive: true, force: true });
    }
    const parent = path.dirname(path.resolve(aafRepo));
    const manual = applyCanonicalSiblingPreference([
        path.join(canonical, 'docs', 'ai_atomic_framework'),
        path.join(stale, 'docs', 'ai_atomic_framework')
    ], parent);
    assert.equal(manual.roots.length, 1);
}
finally {
    rmSync(sandbox, { recursive: true, force: true });
}
// TASK-ERR-0007 operator contract for planning-root ambiguity.
// caseId: test_planning_root_ambiguous_error_contract_0007
// semanticKey: planning_root_ambiguous_error_contract
// coversAcceptance: ACC-1, ACC-2, ACC-3, ACC-4
// contractEdge: ATM_PLANNING_ROOT_AMBIGUOUS
{
    const registry = JSON.parse(readFileSync(path.join(process.cwd(), 'docs', 'governance', 'error-code-registry.json'), 'utf8'));
    // ACC-1 / ACC-3: the emitted code must have an exact registry contract, not only prefix coverage.
    const registryEntry = registry.entries.find((entry) => entry.code === PLANNING_ROOT_AMBIGUOUS_CODE);
    assert.ok(registryEntry, 'ATM_PLANNING_ROOT_AMBIGUOUS must have an exact registry entry');
    assert.equal(registryEntry?.category, 'planning');
    assert.equal(registryEntry?.retryable, true);
    assert.equal(registryEntry?.requiresHumanApproval, false);
    assert.equal(registryEntry?.sourceOwner, 'packages/cli/src/commands/next/planning-root-preference.ts', 'registry sourceOwner must name the emitter');
    const contractSandbox = mkdtempSync(path.join(tmpdir(), 'planning-root-contract-'));
    try {
        const makeRepo = (name, withPlanningRoot) => {
            const repo = path.join(contractSandbox, name);
            if (withPlanningRoot) {
                mkdirSync(path.join(repo, 'docs', 'ai_atomic_framework'), { recursive: true });
                writeFileSync(path.join(repo, 'docs', 'ai_atomic_framework', 'marker.txt'), 'ok', 'utf8');
            }
            else {
                mkdirSync(repo, { recursive: true });
            }
            return repo;
        };
        // Fixture class 1: an explicit planning root always wins and never fails closed.
        const explicitHome = makeRepo('ExplicitHome', false);
        const explicitRoot = path.join(makeRepo('ExplicitPlanning', true), 'docs', 'ai_atomic_framework');
        const explicitSelection = selectPlanningRoot(explicitHome, {
            explicitRoot,
            readDir: fakeReadDir(contractSandbox, ['ExplicitHome', 'ExplicitPlanning']),
            exists: existsSync
        });
        assert.equal(explicitSelection.status, 'explicit');
        assert.equal(explicitSelection.failClosed, false);
        assert.deepEqual([...explicitSelection.resolvedRoots], [path.resolve(explicitRoot)]);
        assert.deepEqual([...explicitSelection.ambiguities], []);
        // Fixture class 2: one canonical base directory resolves its derivatives without ambiguity.
        const canonicalHome = makeRepo('CanonicalHome', false);
        makeRepo('CanonicalPlan', true);
        makeRepo('CanonicalPlan-derivative', true);
        const canonicalSelection = selectPlanningRoot(canonicalHome, {
            readDir: fakeReadDir(contractSandbox, ['CanonicalHome', 'CanonicalPlan', 'CanonicalPlan-derivative']),
            exists: existsSync
        });
        assert.equal(canonicalSelection.status, 'canonical');
        assert.equal(canonicalSelection.failClosed, false);
        assert.deepEqual([...canonicalSelection.ambiguities], []);
        assert.equal(canonicalSelection.resolvedRoots.some((entry) => entry.includes('CanonicalPlan-derivative')), false, 'derivative root must not be offered once a canonical base exists');
        // Fixture class 3: a true prefix family with no canonical base must fail closed.
        const ambiguousHome = makeRepo('AmbiguousHome', false);
        makeRepo('Rescue-alpha', true);
        makeRepo('Rescue-beta', true);
        const ambiguousSelection = selectPlanningRoot(ambiguousHome, {
            readDir: fakeReadDir(contractSandbox, ['AmbiguousHome', 'Rescue-alpha', 'Rescue-beta']),
            exists: existsSync
        });
        assert.equal(ambiguousSelection.status, 'ambiguous');
        // ACC-2: fail closed. No root may be handed back for the caller to guess with.
        assert.equal(ambiguousSelection.failClosed, true);
        assert.deepEqual([...ambiguousSelection.resolvedRoots], []);
        assert.equal(ambiguousSelection.ambiguities.length, 1);
        const ambiguity = ambiguousSelection.ambiguities[0];
        assert.equal(ambiguity.code, PLANNING_ROOT_AMBIGUOUS_CODE);
        assert.equal(ambiguity.prefix, 'Rescue');
        assert.deepEqual([...ambiguity.siblingRepoDirs], ['Rescue-alpha', 'Rescue-beta']);
        // ACC-2: diagnostics carry candidate roots and source availability, not just directory names.
        assert.equal(ambiguity.candidates.length, 2);
        for (const candidate of ambiguity.candidates) {
            assert.ok(path.isAbsolute(candidate.planningRoot), 'candidate must expose an absolute planning root');
            assert.ok(path.isAbsolute(candidate.repoDir), 'candidate must expose an absolute repo dir');
            assert.equal(candidate.sourceAvailable, true, 'candidate must report source availability');
        }
        assert.deepEqual(ambiguity.candidates.map((candidate) => candidate.repoDirName), ['Rescue-alpha', 'Rescue-beta']);
        // ACC-2 / ACC-4: exactly one safe non-destructive recovery route, and cleanup stays owner-approved.
        const recovery = ambiguity.recovery;
        assert.equal(recovery.code, PLANNING_ROOT_AMBIGUOUS_CODE);
        assert.equal(recovery.retryable, registryEntry?.retryable);
        assert.equal(recovery.requiresHumanApproval, registryEntry?.requiresHumanApproval);
        assert.equal(recovery.safeNextSteps.length, 1, 'exactly one safe non-destructive recovery route');
        assert.match(recovery.safeNextSteps[0] ?? '', /--planning-root/);
        assert.ok(recovery.readOnlyInspectionSteps.length >= 1, 'ambiguous roots must be inspectable before any owner-approved cleanup');
        assert.ok(recovery.forbiddenActions.includes('auto-cleanup-ambiguous-planning-roots'), 'automatic cleanup must be forbidden');
        assert.ok(recovery.forbiddenActions.includes('silently-select-first-planning-root'), 'silently selecting the first directory must be forbidden');
        for (const step of [...recovery.safeNextSteps, ...recovery.readOnlyInspectionSteps]) {
            assert.doesNotMatch(step, /\brm\b|\brmdir\b|--force|worktree remove|--no-verify/);
        }
        // ACC-1: the emitter detail must agree with the registered trigger wording.
        assert.match(ambiguity.detail, /Multiple sibling planning repos share prefix "Rescue"/);
        assert.ok((registryEntry?.remediation ?? []).some((line) => line.includes('--planning-root')), 'registry remediation must publish the same explicit-root recovery route as the emitter');
        // Deep module: callers consume one object; they never re-scan or splice message text.
        const legacyResolution = resolveCandidatePlanningRoots(ambiguousHome, {
            readDir: fakeReadDir(contractSandbox, ['AmbiguousHome', 'Rescue-alpha', 'Rescue-beta']),
            exists: existsSync
        });
        assert.equal(legacyResolution.warnings.length, 1);
        assert.equal(legacyResolution.warnings[0]?.code, PLANNING_ROOT_AMBIGUOUS_CODE);
        assert.deepEqual([...(legacyResolution.warnings[0]?.siblingRepoDirs ?? [])], [...ambiguity.siblingRepoDirs], 'legacy warning shape must stay compatible with the registered contract');
    }
    finally {
        rmSync(contractSandbox, { recursive: true, force: true });
    }
}
console.log('[planning-root-preference.test] ok');
