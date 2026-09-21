import path from 'node:path';
import { buildCatalog } from './atom-ref-readability/catalog.js';
import { applyCallsiteRewrites, collectDefinedReadableRefs, evaluateCallsites, planCallsiteRewrites, scanCallsites } from './atom-ref-readability/callsites.js';
import { existsSync, readJson } from './atom-ref-readability/files.js';
import { writeGeneratedRefs, writeReports } from './atom-ref-readability/reports.js';
import { asRecord, atomIdPattern, generatedPathsForRepo } from './atom-ref-readability/types.js';
export function sweepAtomRefReadability(options) {
    const generatedAt = options.generatedAt ?? new Date().toISOString();
    const repos = options.repos.length > 0 ? options.repos : [process.cwd()];
    return {
        schemaId: 'atm.atomRefSweep',
        specVersion: '0.1.0',
        generatedAt,
        apply: options.apply,
        repos: repos.map((repoPath) => inspectRepo(path.resolve(repoPath), options.apply, generatedAt, {
            allowPlannedRewrites: true
        }))
    };
}
export function validateAtomRefReadability(repoPath) {
    return inspectRepo(path.resolve(repoPath), false, new Date().toISOString(), {
        allowPlannedRewrites: false
    });
}
function inspectRepo(repoPath, apply, generatedAt, options) {
    const registryPath = path.join(repoPath, 'atomic-registry.json');
    if (!existsSync(registryPath)) {
        return missingRegistryReport(repoPath);
    }
    const registry = asRecord(readJson(registryPath));
    const catalog = buildCatalog(repoPath, registry);
    const callsites = scanCallsites(repoPath);
    const generatedRefNames = new Set(catalog.map((entry) => entry.refName));
    const existingRefNames = collectDefinedReadableRefs(repoPath);
    const knownRefNames = new Set([...generatedRefNames, ...existingRefNames]);
    const rewrites = planCallsiteRewrites(callsites, catalog);
    const violations = evaluateCallsites(callsites, knownRefNames, options.allowPlannedRewrites ? rewrites : []);
    const generatedRefPaths = generatedPathsForRepo(repoPath);
    const reportPaths = [
        'atomic_workbench/reports/atom-callsite-inventory.json',
        'atomic_workbench/reports/atom-ref-migration-report.json',
        'atomic_workbench/reports/atom-callsite-readability.report.json',
        'atomic_workbench/reports/atom-ref-rollback-instructions.md'
    ];
    if (apply) {
        writeGeneratedRefs(repoPath, catalog);
        applyCallsiteRewrites(repoPath, rewrites);
        writeReports(repoPath, generatedAt, catalog, callsites, violations, rewrites, generatedRefPaths, reportPaths);
    }
    const atomCount = catalog.filter((entry) => entry.kind === 'atom' && atomIdPattern.test(entry.id)).length;
    const mapCount = catalog.filter((entry) => entry.kind === 'map').length;
    const registryAtomIds = new Set((Array.isArray(registry?.entries) ? registry.entries : [])
        .map((entry) => String(asRecord(entry)?.atomId ?? ''))
        .filter(Boolean));
    const memberAtomCount = catalog.filter((entry) => entry.kind === 'atom' && !registryAtomIds.has(entry.id)).length;
    return {
        repoPath,
        ok: violations.length === 0,
        registryPath: 'atomic-registry.json',
        atomCount,
        mapCount,
        memberAtomCount,
        callsiteCount: callsites.length,
        violationCount: violations.length,
        generatedRefPaths,
        reportPaths: apply ? reportPaths : [],
        violations,
        rewrittenCallsites: rewrites,
        skipped: []
    };
}
function missingRegistryReport(repoPath) {
    return {
        repoPath,
        ok: false,
        registryPath: null,
        atomCount: 0,
        mapCount: 0,
        memberAtomCount: 0,
        callsiteCount: 0,
        violationCount: 1,
        generatedRefPaths: [],
        reportPaths: [],
        violations: [{
                file: 'atomic-registry.json',
                line: 1,
                callee: 'runAtm',
                firstArgument: '',
                code: 'registry-missing',
                detail: 'atomic-registry.json is required before readable refs can be generated.'
            }],
        rewrittenCallsites: [],
        skipped: ['registry-missing']
    };
}
