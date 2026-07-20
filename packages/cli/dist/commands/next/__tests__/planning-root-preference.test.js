import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyCanonicalSiblingPreference, isDerivativeSiblingRepoName, resolveCandidatePlanningRoots } from '../planning-root-preference.js';
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
console.log('[planning-root-preference.test] ok');
