import path from 'node:path';
import { writeJson, writeText } from './files.js';
import { renderAdopterAtomRefs, renderAdopterMapRefs, renderFrameworkGeneratedRefs } from './render.js';
import { generatedPathsForRepo, isFrameworkRepo } from './types.js';
export function writeGeneratedRefs(repoPath, catalog) {
    const generatedPaths = generatedPathsForRepo(repoPath);
    if (isFrameworkRepo(repoPath)) {
        writeText(path.join(repoPath, generatedPaths[0]), renderFrameworkGeneratedRefs(catalog));
        return;
    }
    writeText(path.join(repoPath, generatedPaths[0]), renderAdopterAtomRefs(catalog.filter((entry) => entry.kind === 'atom')));
    writeText(path.join(repoPath, generatedPaths[1]), renderAdopterMapRefs(catalog.filter((entry) => entry.kind === 'map')));
}
export function writeReports(repoPath, generatedAt, catalog, callsites, violations, rewrites, generatedRefPaths, reportPaths) {
    writeJson(path.join(repoPath, reportPaths[0]), {
        schemaId: 'atm.atomCallsiteInventory',
        specVersion: '0.1.0',
        generatedAt,
        catalog,
        callsites
    });
    writeJson(path.join(repoPath, reportPaths[1]), {
        schemaId: 'atm.atomRefMigrationReport',
        specVersion: '0.1.0',
        generatedAt,
        generatedRefPaths,
        rewrittenCallsites: rewrites,
        skippedCallsites: callsites.filter((callsite) => !rewrites.some((rewrite) => rewrite.file === callsite.file && rewrite.line === callsite.line))
    });
    writeJson(path.join(repoPath, reportPaths[2]), {
        schemaId: 'atm.atomCallsiteReadabilityReport',
        specVersion: '0.1.0',
        generatedAt,
        ok: violations.length === 0,
        violationCount: violations.length,
        violations
    });
    writeText(path.join(repoPath, reportPaths[3]), [
        '# Atom Ref Rollback Instructions',
        '',
        'This sweep only generated readable ref files, callsite replacements, and reports.',
        '',
        'Rollback by removing generated files listed in atom-ref-migration-report.json and reverting rewritten callsites listed in rewrittenCallsites.',
        'Do not edit .atm runtime state manually.'
    ].join('\n') + '\n');
}
