import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CliError, makeResult, message, readFrameworkVersion, relativePathFrom } from './shared.js';
import { assertRunnerSyncAdmission, inspectRunnerSyncAdmission } from './framework-development/runner-sync-admission.js';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const defaultOnefileRunnerPath = 'release/atm-onefile/atm.mjs';
const forbiddenAdopterScratchPaths = Object.freeze([
    'scratch/atm-build-repo',
    'scratch/atm-upstream-patch'
]);
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
export function inspectReleasePublicationReadiness(input) {
    const dirtyFiles = normalizePaths(input.dirtyFiles ?? readGitDirtyFiles(input.cwd));
    const sealedSourceCommit = normalizeOptionalText(input.sealedSourceCommit);
    const artifactSha256 = normalizeOptionalText(input.artifactSha256);
    const publicationReceipt = normalizeOptionalText(input.publicationReceipt);
    const activeCaptains = normalizeActiveCaptains(input.activeCaptains ?? []);
    const foreignCaptains = activeCaptains.filter((captain) => captain !== input.stewardActorId);
    const agreement = normalizeOptionalText(input.ownershipAgreement);
    const sealedSourceStateOk = dirtyFiles.length === 0 && Boolean(sealedSourceCommit);
    const ownershipOk = foreignCaptains.length === 0 || Boolean(agreement);
    const ok = sealedSourceStateOk && ownershipOk && Boolean(artifactSha256) && Boolean(publicationReceipt);
    return {
        schemaId: 'atm.releasePublicationReadiness.v1',
        ok,
        stewardActorId: input.stewardActorId,
        sealedSourceCommit,
        generatedArtifactDigest: artifactSha256,
        publicationReceipt,
        dirtyFiles,
        sealedSourceState: {
            ok: sealedSourceStateOk,
            reason: sealedSourceCommit
                ? dirtyFiles.length === 0
                    ? null
                    : 'publication validation requires a sealed source state; commit or stash dirty files before runner sync'
                : 'sealed source commit is required'
        },
        ownership: {
            ok: ownershipOk,
            activeCaptains,
            agreement,
            reason: ownershipOk ? null : 'concurrent runner-sync captains must agree on release artifact ownership first'
        },
        requiredCommand: ok
            ? null
            : 'seal source commit, record one release steward, artifact digest, and publication receipt before internal-release sync'
    };
}
export function assertReleasePublicationReadiness(report) {
    if (report.ok)
        return;
    const error = new Error(report.requiredCommand ?? 'Release publication readiness failed.');
    Object.assign(error, {
        code: report.sealedSourceState.ok ? 'ATM_RELEASE_PUBLICATION_OWNERSHIP_BLOCKED' : 'ATM_RELEASE_PUBLICATION_SEALED_SOURCE_REQUIRED',
        details: report
    });
    throw error;
}
export function createReleasePublicationReceipt(input) {
    const sealedSourceCommit = normalizeOptionalText(input.sealedSourceCommit);
    if (!sealedSourceCommit) {
        throw new CliError('ATM_RELEASE_PUBLICATION_SOURCE_COMMIT_REQUIRED', 'Release publication receipt requires a sealed source commit.', { exitCode: 1 });
    }
    if (!input.artifactSha256.trim()) {
        throw new CliError('ATM_RELEASE_PUBLICATION_ARTIFACT_DIGEST_REQUIRED', 'Release publication receipt requires the generated artifact digest.', { exitCode: 1 });
    }
    return {
        schemaId: 'atm.releasePublicationReceipt.v1',
        stewardActorId: input.stewardActorId,
        sealedSourceCommit,
        artifactPath: input.artifactPath,
        artifactSha256: input.artifactSha256,
        publicationReceipt: input.publicationReceipt,
        generatedAt: input.generatedAt ?? new Date().toISOString()
    };
}
function syncTarget(input) {
    const repoPath = path.resolve(input.options.cwd, input.repo);
    const repoName = path.basename(repoPath);
    const skipReason = input.skipMatcher(repoPath);
    const runnerPath = path.join(repoPath, 'atm.mjs');
    const metadataPath = path.join(repoPath, '.atm', 'runtime', 'pinned-runner.json');
    const warnings = [];
    const emptyScratchGuard = createEmptyScratchGuard(input.options);
    if (skipReason) {
        return {
            repo: repoPath,
            repoName,
            skipped: true,
            skipReason,
            ok: true,
            runnerPath: relativePathFrom(repoPath, runnerPath),
            metadataPath: relativePathFrom(repoPath, metadataPath),
            previousSha256: null,
            newSha256: null,
            backupPath: null,
            verification: [],
            warnings,
            scratchGuard: emptyScratchGuard
        };
    }
    if (!existsSync(repoPath)) {
        return failedTarget(repoPath, runnerPath, metadataPath, 'target repo does not exist', emptyScratchGuard);
    }
    const scratchGuard = cleanForbiddenAdopterScratch(repoPath, input.options);
    if (scratchGuard.present.length > 0) {
        warnings.push(input.options.keepTemp
            ? 'known ATM scratch directories are present and were kept because --keep-temp was set'
            : input.options.dryRun
                ? 'known ATM scratch directories are present; dry-run reports them without cleanup'
                : 'known ATM scratch directories were removed from the target repo');
    }
    if (!scratchGuard.ok) {
        return failedTarget(repoPath, runnerPath, metadataPath, 'target ATM scratch cleanup failed', scratchGuard);
    }
    const previousSha256 = existsSync(runnerPath) ? sha256File(runnerPath) : null;
    const backupPath = previousSha256
        ? path.join(repoPath, '.atm', 'history', 'reports', 'internal-release-sync', input.runId, 'atm.mjs.previous')
        : null;
    if (!existsSync(path.join(repoPath, '.atm', 'config.json'))) {
        warnings.push('.atm/config.json is missing; target may not be bootstrapped');
    }
    if (!input.options.dryRun) {
        if (backupPath) {
            mkdirSync(path.dirname(backupPath), { recursive: true });
            copyFileSync(runnerPath, backupPath);
        }
        copyFileSync(input.sourceRunnerPath, runnerPath);
        mkdirSync(path.dirname(metadataPath), { recursive: true });
        writeFileSync(metadataPath, `${JSON.stringify({
            schemaVersion: 'atm.pinnedRunner.v0.1',
            runnerPath: 'atm.mjs',
            metadataPath: '.atm/runtime/pinned-runner.json',
            command: 'node atm.mjs next --json',
            status: previousSha256 ? 'replaced' : 'installed',
            sourceKind: 'internal-build-sync',
            sourcePath: input.sourceRunnerPath,
            sha256: input.sourceSha256,
            existingSha256: previousSha256,
            sizeBytes: statSync(input.sourceRunnerPath).size,
            frameworkVersion: readFrameworkVersion(input.options.cwd),
            sourceCommit: input.sourceCommit,
            generatedAt: new Date().toISOString()
        }, null, 2)}\n`, 'utf8');
    }
    const verification = input.options.verify && !input.options.dryRun
        ? [
            runNodeAtm(repoPath, ['doctor', '--json']),
            runNodeAtm(repoPath, ['framework-mode', 'status', '--json']),
            runNodeAtm(repoPath, ['tasks', 'audit', '--json'])
        ]
        : [];
    const verificationOk = verification.every((run) => run.ok);
    return {
        repo: repoPath,
        repoName,
        skipped: false,
        skipReason: null,
        ok: input.options.allowVerifyFailure ? true : verificationOk,
        runnerPath: relativePathFrom(repoPath, runnerPath),
        metadataPath: relativePathFrom(repoPath, metadataPath),
        previousSha256,
        newSha256: input.options.dryRun ? input.sourceSha256 : sha256File(runnerPath),
        backupPath: backupPath ? relativePathFrom(repoPath, backupPath) : null,
        verification,
        warnings,
        scratchGuard
    };
}
function failedTarget(repoPath, runnerPath, metadataPath, reason, scratchGuard) {
    return {
        repo: repoPath,
        repoName: path.basename(repoPath),
        skipped: false,
        skipReason: null,
        ok: false,
        runnerPath: relativePathFrom(repoPath, runnerPath),
        metadataPath: relativePathFrom(repoPath, metadataPath),
        previousSha256: null,
        newSha256: null,
        backupPath: null,
        verification: [{
                command: 'internal target preflight',
                cwd: repoPath,
                exitCode: 1,
                stdoutSha256: sha256Text(reason),
                stderrSha256: sha256Text(''),
                ok: false
            }],
        warnings: [reason],
        scratchGuard
    };
}
function parseInternalReleaseSyncOptions(argv) {
    const repos = [];
    const skips = [];
    const options = {
        cwd: process.cwd(),
        build: true,
        dryRun: false,
        verify: true,
        allowVerifyFailure: false,
        source: null,
        keepTemp: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd' || arg === '--framework-root') {
            options.cwd = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--repo') {
            repos.push(requireValue(argv, index, arg));
            index += 1;
            continue;
        }
        if (arg === '--skip' || arg === '--exclude') {
            skips.push(requireValue(argv, index, arg));
            index += 1;
            continue;
        }
        if (arg === '--source') {
            options.source = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--no-build') {
            options.build = false;
            continue;
        }
        if (arg === '--dry-run') {
            options.dryRun = true;
            continue;
        }
        if (arg === '--no-verify') {
            options.verify = false;
            continue;
        }
        if (arg === '--allow-verify-failure') {
            options.allowVerifyFailure = true;
            continue;
        }
        if (arg === '--keep-temp') {
            options.keepTemp = true;
            continue;
        }
        if (arg === '--json' || arg === '--pretty')
            continue;
        throw new CliError('ATM_CLI_USAGE', `internal-release sync does not support option ${arg}`, { exitCode: 2 });
    }
    return {
        cwd: path.resolve(options.cwd),
        repos,
        skips,
        build: options.build,
        dryRun: options.dryRun,
        verify: options.verify,
        allowVerifyFailure: options.allowVerifyFailure,
        source: options.source,
        keepTemp: options.keepTemp
    };
}
function cleanForbiddenAdopterScratch(repoPath, options) {
    const present = [];
    const removed = [];
    const kept = [];
    const errors = [];
    let fileCount = 0;
    let freedBytes = 0;
    for (const relativePath of forbiddenAdopterScratchPaths) {
        const absolutePath = path.join(repoPath, relativePath);
        if (!existsSync(absolutePath))
            continue;
        present.push(relativePath);
        const summary = summarizePath(absolutePath);
        fileCount += summary.fileCount;
        if (options.dryRun || options.keepTemp) {
            kept.push(relativePath);
            continue;
        }
        try {
            rmSync(absolutePath, { recursive: true, force: true });
            removed.push(relativePath);
            freedBytes += summary.totalBytes;
        }
        catch (error) {
            errors.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return {
        forbiddenRelativePaths: forbiddenAdopterScratchPaths,
        present,
        removed,
        kept,
        fileCount,
        freedBytes,
        dryRun: options.dryRun,
        keepTemp: options.keepTemp,
        errors,
        ok: errors.length === 0
    };
}
function createEmptyScratchGuard(options) {
    return {
        forbiddenRelativePaths: forbiddenAdopterScratchPaths,
        present: [],
        removed: [],
        kept: [],
        fileCount: 0,
        freedBytes: 0,
        dryRun: options.dryRun,
        keepTemp: options.keepTemp,
        errors: [],
        ok: true
    };
}
function summarizePath(absolutePath) {
    const stats = statSync(absolutePath);
    if (!stats.isDirectory()) {
        return { fileCount: 1, totalBytes: stats.size };
    }
    let fileCount = 0;
    let totalBytes = 0;
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
        const child = path.join(absolutePath, entry.name);
        const summary = summarizePath(child);
        fileCount += summary.fileCount;
        totalBytes += summary.totalBytes;
    }
    return { fileCount, totalBytes };
}
function createSkipMatcher(skips, cwd) {
    const normalized = skips.map((entry) => ({
        raw: entry,
        name: entry.trim().toLowerCase(),
        path: path.resolve(cwd, entry).toLowerCase()
    }));
    return (repoPath) => {
        const resolved = path.resolve(repoPath).toLowerCase();
        const name = path.basename(repoPath).toLowerCase();
        const match = normalized.find((entry) => entry.name === name || entry.path === resolved);
        return match ? `matched --skip ${match.raw}` : null;
    };
}
function runNodeAtm(cwd, args) {
    return runCommand(cwd, process.execPath, ['atm.mjs', ...args]);
}
function runNpmBuildAfterAdmission(cwd) {
    const sourceCommit = readGitScalar(cwd, ['rev-parse', '--verify', 'HEAD']);
    const stewardActorId = process.env.ATM_ACTOR_ID?.trim()
        || process.env.AGENT_IDENTITY?.trim()
        || 'release-steward';
    assertRunnerSyncAdmission(inspectRunnerSyncAdmission({
        cwd,
        stewardActorId,
        sealedSourceSha: sourceCommit
    }));
    assertReleasePublicationReadiness(inspectReleasePublicationReadiness({
        cwd,
        stewardActorId,
        sealedSourceCommit: sourceCommit,
        artifactPath: defaultOnefileRunnerPath,
        artifactSha256: existsSync(path.join(cwd, defaultOnefileRunnerPath)) ? sha256File(path.join(cwd, defaultOnefileRunnerPath)) : null,
        publicationReceipt: '.atm/history/reports/internal-release-sync/<run-id>/publication-receipt.json',
        activeCaptains: readActiveReleaseCaptainsFromEnv(stewardActorId),
        ownershipAgreement: process.env.ATM_RELEASE_ARTIFACT_OWNER_AGREEMENT ?? null
    }));
    if (process.platform === 'win32') {
        return runCommand(cwd, 'cmd.exe', ['/c', 'npm', 'run', 'build']);
    }
    return runCommand(cwd, 'npm', ['run', 'build']);
}
function readGitDirtyFiles(cwd) {
    const result = spawnSync('git', ['status', '--porcelain'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.status !== 0 || result.error)
        return [];
    return result.stdout
        .split(/\r?\n/)
        .map((line) => line.length >= 4 ? line.slice(3).trim() : '')
        .map((entry) => entry.includes(' -> ') ? entry.split(' -> ').at(-1) ?? entry : entry)
        .filter(Boolean);
}
function normalizePaths(paths) {
    return [...new Set(paths.map((entry) => entry.replace(/\\/g, '/').replace(/^\.\//, '').trim()).filter(Boolean))].sort();
}
function normalizeActiveCaptains(values) {
    return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))].sort();
}
function normalizeOptionalText(value) {
    const text = String(value ?? '').trim();
    return text ? text : null;
}
function readActiveReleaseCaptainsFromEnv(stewardActorId) {
    const raw = process.env.ATM_RELEASE_ARTIFACT_OWNERS ?? process.env.ATM_RELEASE_ARTIFACT_CAPTAINS ?? '';
    const owners = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
    return owners.length > 0 ? owners : [stewardActorId];
}
function runCommand(cwd, command, args) {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    const stdout = result.stdout ?? '';
    const stderr = [result.stderr ?? '', result.error?.message ?? ''].filter(Boolean).join('\n');
    return {
        command: [path.basename(command), ...args].join(' '),
        cwd,
        exitCode: result.status ?? 1,
        stdoutSha256: sha256Text(stdout),
        stderrSha256: sha256Text(stderr),
        ok: !result.error && result.status === 0
    };
}
function readGitScalar(cwd, args) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    return !result.error && result.status === 0 ? result.stdout.trim() : null;
}
function requireValue(argv, index, flag) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `${flag} requires a value.`, { exitCode: 2 });
    }
    return value;
}
function sha256File(filePath) {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}
function sha256Text(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
