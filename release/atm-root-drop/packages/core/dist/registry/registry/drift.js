import path from 'node:path';
import { createSourceHashSnapshot, normalizeSourcePathList } from '../../hash-lock/hash-lock.js';
export function evaluateRegistryEntryDrift(entry, options = {}) {
    const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
    const sourcePaths = entry?.selfVerification?.sourcePaths;
    if (!sourcePaths?.spec) {
        return {
            ok: false,
            issues: ['sourcePaths'],
            report: null,
            entry,
            error: 'Registry entry is missing selfVerification.sourcePaths.spec.'
        };
    }
    try {
        const current = createSourceHashSnapshot({
            repositoryRoot,
            specPath: sourcePaths.spec,
            codePaths: normalizeSourcePathList(sourcePaths.code),
            testPaths: sourcePaths.tests,
            legacyPlanningId: entry.selfVerification.legacyPlanningId ?? null
        });
        const report = {
            legacyPlanningId: {
                expected: entry.selfVerification.legacyPlanningId ?? null,
                actual: current.legacyPlanningId,
                ok: (entry.selfVerification.legacyPlanningId ?? null) === current.legacyPlanningId
            },
            specHash: {
                expected: entry.selfVerification.specHash,
                actual: current.specHash,
                ok: entry.selfVerification.specHash === current.specHash
            },
            codeHash: {
                expected: entry.selfVerification.codeHash,
                actual: current.codeHash,
                ok: entry.selfVerification.codeHash === current.codeHash
            },
            testHash: {
                expected: entry.selfVerification.testHash,
                actual: current.testHash,
                ok: entry.selfVerification.testHash === current.testHash
            }
        };
        return {
            ok: Object.values(report).every((value) => value.ok === true),
            issues: Object.entries(report).filter(([, value]) => value.ok !== true).map(([key]) => key),
            report,
            entry
        };
    }
    catch (error) {
        return {
            ok: false,
            issues: ['sourcePaths'],
            report: null,
            entry,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
