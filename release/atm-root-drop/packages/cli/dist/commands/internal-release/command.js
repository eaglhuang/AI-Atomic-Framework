import { existsSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message, relativePathFrom } from '../shared.js';
import { defaultOnefileRunnerPath } from './constants.js';
import { parseInternalReleaseSyncOptions } from './options.js';
import { assertReleasePublicationReadiness, createReleasePublicationReceipt, inspectReleasePublicationReadiness, runNpmBuildAfterAdmission } from './publication.js';
import { syncTarget } from './target-sync.js';
import { createSkipMatcher, readActiveReleaseCaptainsFromEnv, readGitScalar, sha256File } from './support.js';
export function runInternalRelease(argv) {
    const action = argv.find((entry) => !entry.startsWith('-'));
    if (action !== 'sync') {
        throw new CliError('ATM_CLI_USAGE', 'internal-release supports only: sync.', { exitCode: 2 });
    }
    const options = parseInternalReleaseSyncOptions(argv.slice(argv.indexOf(action) + 1));
    const report = runInternalReleaseSync(options);
    return makeResult({
        ok: report.ok,
        command: 'internal-release',
        cwd: options.cwd,
        messages: [
            report.ok
                ? message('info', 'ATM_INTERNAL_RELEASE_SYNC_OK', 'Internal ATM build runner sync completed.', {
                    synced: report.syncedCount,
                    skipped: report.skippedCount
                })
                : message('error', 'ATM_INTERNAL_RELEASE_SYNC_FAILED', 'Internal ATM build runner sync found failed targets.', {
                    failed: report.failedTargets
                })
        ],
        evidence: report
    });
}
export function runInternalReleaseSync(options) {
    if (options.repos.length === 0) {
        throw new CliError('ATM_CLI_USAGE', 'internal-release sync requires at least one --repo <path>.', { exitCode: 2 });
    }
    const buildRun = options.build
        ? runNpmBuildAfterAdmission(options.cwd)
        : null;
    if (buildRun && buildRun.exitCode !== 0) {
        throw new CliError('ATM_INTERNAL_RELEASE_BUILD_FAILED', 'npm run build failed before internal release sync.', {
            details: { buildRun }
        });
    }
    const sourceRunnerPath = path.resolve(options.cwd, options.source ?? defaultOnefileRunnerPath);
    if (!existsSync(sourceRunnerPath)) {
        throw new CliError('ATM_INTERNAL_RELEASE_SOURCE_MISSING', 'Internal release source runner is missing. Run with --build or provide --source.', {
            exitCode: 1,
            details: { sourceRunnerPath: relativePathFrom(options.cwd, sourceRunnerPath) }
        });
    }
    const sourceSha256 = sha256File(sourceRunnerPath);
    const runId = `internal-release-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const sourceCommit = readGitScalar(options.cwd, ['rev-parse', '--verify', 'HEAD']);
    const stewardActorId = process.env.ATM_ACTOR_ID?.trim()
        || process.env.AGENT_IDENTITY?.trim()
        || 'release-steward';
    const publicationReceiptPath = `.atm/history/reports/internal-release-sync/${runId}/publication-receipt.json`;
    const publicationReadiness = inspectReleasePublicationReadiness({
        cwd: options.cwd,
        stewardActorId,
        sealedSourceCommit: sourceCommit,
        artifactPath: relativePathFrom(options.cwd, sourceRunnerPath),
        artifactSha256: sourceSha256,
        publicationReceipt: publicationReceiptPath,
        dirtyFiles: options.build ? [] : null,
        activeCaptains: readActiveReleaseCaptainsFromEnv(stewardActorId),
        ownershipAgreement: process.env.ATM_RELEASE_ARTIFACT_OWNER_AGREEMENT ?? null
    });
    assertReleasePublicationReadiness(publicationReadiness);
    const publicationReceipt = createReleasePublicationReceipt({
        stewardActorId,
        sealedSourceCommit: sourceCommit,
        artifactPath: relativePathFrom(options.cwd, sourceRunnerPath),
        artifactSha256: sourceSha256,
        publicationReceipt: publicationReceiptPath
    });
    const skipMatcher = createSkipMatcher(options.skips, options.cwd);
    const targets = options.repos.map((repo) => syncTarget({
        repo,
        options,
        sourceRunnerPath,
        sourceSha256,
        sourceCommit,
        runId,
        skipMatcher
    }));
    const failedTargets = targets
        .filter((target) => !target.skipped && !target.ok)
        .map((target) => target.repoName);
    return {
        schemaId: 'atm.internalReleaseSyncReport',
        specVersion: '0.1.0',
        generatedAt: new Date().toISOString(),
        runId,
        frameworkRoot: options.cwd,
        sourceRunnerPath: relativePathFrom(options.cwd, sourceRunnerPath),
        sourceSha256,
        sourceCommit,
        publicationReadiness,
        publicationReceipt,
        build: buildRun,
        dryRun: options.dryRun,
        verify: options.verify,
        allowVerifyFailure: options.allowVerifyFailure,
        keepTemp: options.keepTemp,
        targets,
        syncedCount: targets.filter((target) => !target.skipped && target.ok).length,
        skippedCount: targets.filter((target) => target.skipped).length,
        failedTargets,
        ok: failedTargets.length === 0
    };
}
