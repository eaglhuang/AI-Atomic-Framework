import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runHashPlaceholderAudit } from '../hash-placeholder-audit.js';
import { checkStartupKnownBadVersion } from '../../startup-known-bad.js';
import { checkStartupIntegrity, resolveBundledIntegrityRoot } from '../../startup-integrity.js';
import { createATMVersionSummary } from '../atm-chart.js';
import { detectFrameworkRepoIdentity, detectFrameworkStaleLocks } from '../framework-development.js';
import { inspectGitWorktreeReadiness } from '../git-worktree-readiness.js';
import { createGitHeadEvidenceCheck } from '../git-head-evidence.js';
import { atmLayoutVersion, bootstrapTaskId, detectGovernanceRuntime } from '../governance-runtime.js';
import { checkIntegrationHealth, describeIntegrationInstallHint, inspectIntegrationBootstrap } from '../integration.js';
import { inspectRuntimeAdapterReadiness } from '../runtime-adapter-readiness.js';
import { makeResult, message, parseOptions, relativePathFrom } from '../shared.js';
import { detectCrossTaskMutation, readIncidentFlag } from '../../../../core/dist/broker/cross-task-mutation-guard.js';
import { inspectRunnerSourceDrift } from '../framework-development/closure-packet-schema.js';
import { knownTsNoCheckBaseline, knownTsNoCheckCleanupOwners, legacyBehaviorPackageNames } from './constants.js';
import { applyDoctorPolicyToCheck, downgradeAdopterGitHeadEvidenceCheck, resolveDoctorPolicy } from './policy.js';
import { checkOnboardingLifecycle, createVersionSummaryMessages } from './lifecycle.js';
import { createBacklogSyncCheck, createGovernanceEntryReadinessCheck, hasRequiredScripts, isFrameworkContractExpected } from './readiness.js';
import { checkCharterIntegrityV2, listFiles, listPackageDirs, packageDirLabel, readJsonIfExists, createCheck, createIntegrationDriftRemediation } from './utilities.js';
function hasTsNoCheckPragma(source) {
    const withoutBom = source.replace(/^\uFEFF/, '');
    const lines = withoutBom.split(/\r?\n/, 5);
    for (const line of lines) {
        if (/^\s*$/.test(line) || /^#!\s*/.test(line)) {
            continue;
        }
        return /^\s*\/\/\s*@ts-nocheck\b/.test(line);
    }
    return false;
}
function createTsNoCheckCleanupOwnerGroups(baselineFiles) {
    const remaining = new Set(baselineFiles);
    const ownerGroups = knownTsNoCheckCleanupOwners
        .map((owner) => {
        const files = baselineFiles.filter((filePath) => owner.patterns.some((pattern) => filePath.startsWith(pattern)));
        for (const filePath of files) {
            remaining.delete(filePath);
        }
        return {
            ownerId: owner.ownerId,
            title: owner.title,
            fileCount: files.length,
            files,
            followUp: owner.followUp
        };
    })
        .filter((group) => group.fileCount > 0);
    if (remaining.size > 0) {
        ownerGroups.push({
            ownerId: 'unmapped',
            title: 'Unmapped transitional type cleanup',
            fileCount: remaining.size,
            files: [...remaining].sort(),
            followUp: 'Assign these @ts-nocheck baseline files to an owner before retiring the transitional TypeScript escape-hatch baseline.'
        });
    }
    return ownerGroups;
}
export async function runDoctor(argv) {
    const trustMode = Array.isArray(argv) && argv.includes('--trust');
    const knownBadMode = Array.isArray(argv) && argv.includes('--known-bad');
    const doctorModeFlags = new Set(['--trust', '--known-bad']);
    const { options } = parseOptions((trustMode || knownBadMode) ? argv.filter((arg) => !doctorModeFlags.has(arg)) : [...argv], 'doctor');
    const root = options.cwd;
    const doctorPolicy = resolveDoctorPolicy(options);
    const rootPackage = readJsonIfExists(path.join(root, 'package.json')) ?? {};
    const repoIdentity = detectFrameworkRepoIdentity(root);
    const frameworkContractExpected = isFrameworkContractExpected(repoIdentity);
    const packageDirs = listPackageDirs(root);
    const hashAudit = runHashPlaceholderAudit({ root });
    const runtime = detectGovernanceRuntime(root, bootstrapTaskId);
    const legacyPackages = legacyBehaviorPackageNames.filter((name) => existsSync(path.join(root, 'packages', name)));
    const bannedRootFiles = ['temp.txt', 'tmp_get_git.ps1'];
    const presentRootFiles = bannedRootFiles.filter((name) => existsSync(path.join(root, name)));
    const stableOnefileRunnerAvailable = existsSync(path.join(root, 'release', 'atm-onefile', 'atm.mjs'));
    const tsNoCheckFiles = listFiles(path.join(root, 'packages'))
        .concat(listFiles(path.join(root, 'scripts')))
        .filter((filePath) => /\.(ts|js|mjs)$/.test(filePath))
        .filter((filePath) => !relativePathFrom(root, filePath).replace(/\\/g, '/').includes('/dist/'))
        .filter((filePath) => hasTsNoCheckPragma(readFileSync(filePath, 'utf8')))
        .map((filePath) => relativePathFrom(root, filePath).replace(/\\/g, '/'))
        .sort();
    const unexpectedTsNoCheckFiles = tsNoCheckFiles.filter((filePath) => !knownTsNoCheckBaseline.has(filePath));
    const baselineTsNoCheckFiles = tsNoCheckFiles.filter((filePath) => knownTsNoCheckBaseline.has(filePath));
    const tsNoCheckCleanupOwnerGroups = createTsNoCheckCleanupOwnerGroups(baselineTsNoCheckFiles);
    const missingDist = packageDirs
        .map((packageDir) => packageDirLabel(root, packageDir) === '@ai-atomic-framework/cli'
        ? { packageDir, js: path.join(root, packageDir, 'dist', 'atm.js'), dts: path.join(root, packageDir, 'dist', 'atm.d.ts') }
        : { packageDir, js: path.join(root, packageDir, 'dist', 'index.js'), dts: path.join(root, packageDir, 'dist', 'index.d.ts') })
        .filter((entry) => !existsSync(entry.js) || !existsSync(entry.dts))
        .map((entry) => packageDirLabel(root, entry.packageDir));
    const charterIntegrity = checkCharterIntegrityV2(root);
    const integrationHealth = await checkIntegrationHealth(root);
    const frameworkHookReadiness = (await import('../integration-hooks.js')).inspectFrameworkHookReadiness(root);
    const cleanCheckoutFrameworkHookContractOk = repoIdentity.isFrameworkRepo
        && frameworkHookReadiness.gitHooks.installedHookFiles.every((entry) => entry.present && entry.markerPresent)
        && frameworkHookReadiness.editorHooks.some((entry) => entry.supported
            && entry.manifestHookContractOk
            && entry.installedHookFiles.every((file) => file.present && file.markerPresent));
    const integrationBootstrap = inspectIntegrationBootstrap(root);
    const integrationInstallHint = describeIntegrationInstallHint(integrationBootstrap);
    const runtimeAdapterReadiness = inspectRuntimeAdapterReadiness(root);
    const gitWorktreeReadiness = inspectGitWorktreeReadiness(root);
    const onboardingLifecycle = checkOnboardingLifecycle(root, runtime);
    const versionSummary = createATMVersionSummary(root);
    const runnerSourceDrift = inspectRunnerSourceDrift(root);
    const versionWarnings = createVersionSummaryMessages(versionSummary);
    const trustIntegrity = trustMode ? checkStartupIntegrity(resolveBundledIntegrityRoot()) : null;
    const knownBadStatus = knownBadMode ? checkStartupKnownBadVersion() : null;
    const rawGitHeadEvidenceCheck = createGitHeadEvidenceCheck(root, runtime);
    const gitHeadEvidenceCheck = applyDoctorPolicyToCheck(downgradeAdopterGitHeadEvidenceCheck(rawGitHeadEvidenceCheck, repoIdentity), doctorPolicy);
    const governanceEntryReadiness = createGovernanceEntryReadinessCheck(root, repoIdentity, rawGitHeadEvidenceCheck);
    const backlogSyncCheck = createBacklogSyncCheck(root, repoIdentity);
    const checks = [
        createCheck('package-manager', !frameworkContractExpected || (rootPackage.packageManager === undefined && existsSync(path.join(root, 'package-lock.json')) && !existsSync(path.join(root, 'pnpm-workspace.yaml'))), {
            official: 'npm', packageLock: existsSync(path.join(root, 'package-lock.json')), packageManagerField: rootPackage.packageManager ?? null, pnpmWorkspace: existsSync(path.join(root, 'pnpm-workspace.yaml'))
        }),
        createCheck('public-script-contract', !frameworkContractExpected || hasRequiredScripts(rootPackage.scripts), {
            build: rootPackage.scripts?.build ?? null,
            typecheck: rootPackage.scripts?.typecheck ?? null,
            lint: rootPackage.scripts?.lint ?? null,
            test: rootPackage.scripts?.test ?? null,
            validateQuick: rootPackage.scripts?.['validate:quick'] ?? null,
            validateStandard: rootPackage.scripts?.['validate:standard'] ?? null,
            validateFull: rootPackage.scripts?.['validate:full'] ?? null
        }),
        createCheck('typescript-build-config', !frameworkContractExpected || (existsSync(path.join(root, 'tsconfig.json')) && existsSync(path.join(root, 'tsconfig.build.json')) && (rootPackage.scripts?.build?.includes('tsc') === true || rootPackage.scripts?.build?.includes('scripts/run-sealed-runner-build.ts') === true)), {
            tsconfig: existsSync(path.join(root, 'tsconfig.json')), buildConfig: existsSync(path.join(root, 'tsconfig.build.json')), buildScript: rootPackage.scripts?.build ?? null
        }),
        createCheck('eslint-lint-config', !frameworkContractExpected || (existsSync(path.join(root, 'eslint.config.mjs')) && rootPackage.scripts?.lint?.includes('eslint') === true), {
            eslintConfig: existsSync(path.join(root, 'eslint.config.mjs')), lintScript: rootPackage.scripts?.lint ?? null
        }),
        createCheck('package-surface', !frameworkContractExpected || (existsSync(path.join(root, 'packages/plugin-behavior-pack')) && legacyPackages.length === 0), { behaviorPack: existsSync(path.join(root, 'packages/plugin-behavior-pack')), legacyPackages }),
        createCheck('repo-hygiene', presentRootFiles.length === 0 && !existsSync(path.join(root, 'pnpm-workspace.yaml')), {
            forbiddenFiles: bannedRootFiles,
            presentRootFiles,
            pnpmWorkspace: existsSync(path.join(root, 'pnpm-workspace.yaml'))
        }),
        createCheck('typescript-escape-hatches', unexpectedTsNoCheckFiles.length === 0, {
            hasTsNoCheck: tsNoCheckFiles.length > 0,
            baselineCount: baselineTsNoCheckFiles.length,
            unexpectedFiles: unexpectedTsNoCheckFiles,
            cleanupOwnerGroups: tsNoCheckCleanupOwnerGroups,
            recommendedCleanupCards: tsNoCheckCleanupOwnerGroups.map((group) => ({
                ownerId: group.ownerId,
                title: group.title,
                fileCount: group.fileCount,
                followUp: group.followUp
            })),
            baselinePolicy: 'known transitional @ts-nocheck files are tracked as baseline debt; new files fail doctor while baseline debt is retired by owner-map cleanup cards'
        }),
        createCheck('package-dist', !frameworkContractExpected || missingDist.length === 0 || (repoIdentity.isFrameworkRepo && stableOnefileRunnerAvailable), { packageCount: packageDirs.length, missingDist, stableOnefileRunnerAvailable }),
        createCheck('hash-placeholders', hashAudit.ok, hashAudit),
        createCheck('self-host-alpha-entry', !frameworkContractExpected || (existsSync(path.join(root, 'packages/cli/src/commands/self-host-alpha.ts')) && existsSync(path.join(root, 'docs/SELF_HOSTING_ALPHA.md'))), { command: 'packages/cli/src/commands/self-host-alpha.ts', doc: 'docs/SELF_HOSTING_ALPHA.md' }),
        createCheck('governance-layout-v2', runtime.layoutVersion === atmLayoutVersion, {
            layoutVersion: runtime.layoutVersion,
            expectedLayoutVersion: atmLayoutVersion,
            migrationNeeded: runtime.migrationNeeded
        }),
        createCheck('charter-integrity', charterIntegrity.ok, charterIntegrity),
        createCheck('onboarding-lifecycle', onboardingLifecycle.ok, onboardingLifecycle),
        createCheck('version-compatibility', versionSummary.compatibility.ok || versionSummary.compatibility.code === 'chart-missing', versionSummary),
        createCheck('integration-adapters', integrationHealth.ok, integrationHealth),
        createCheck('team-runtime-backend-capabilities', true, integrationHealth.teamRuntimeBackends),
        createCheck('framework-integration-hooks', frameworkHookReadiness.ok || cleanCheckoutFrameworkHookContractOk, { ...frameworkHookReadiness, cleanCheckoutFrameworkHookContractOk }),
        ...(trustMode && trustIntegrity ? [createCheck('release-trust', trustIntegrity.ok, trustIntegrity)] : []),
        ...(knownBadMode && knownBadStatus ? [createCheck('known-bad-version', knownBadStatus.ok, knownBadStatus)] : []),
        createCheck('git-worktree-readiness', gitWorktreeReadiness.ok, gitWorktreeReadiness),
        gitHeadEvidenceCheck,
        governanceEntryReadiness,
        backlogSyncCheck,
        createCheck('cross-task-mutation-incident', (() => {
            const activeTaskId = runtime.currentTaskId ?? null;
            const block = detectCrossTaskMutation(root, activeTaskId, 'doctor');
            const incident = readIncidentFlag(root);
            return !block && !incident;
        })(), {
            incident: readIncidentFlag(root),
            conflict: detectCrossTaskMutation(root, runtime.currentTaskId ?? null, 'doctor')
        })
    ];
    const ok = checks.every((check) => check.ok);
    const failedChecks = checks.filter((check) => !check.ok).map((check) => check.name);
    const integrationDriftRemediation = createIntegrationDriftRemediation(integrationHealth);
    const recommendedAction = ok
        ? 'node atm.mjs next --json'
        : failedChecks.includes('charter-integrity')
            ? 'node atm.mjs init --adopt default --force to reinstall the AtomicCharter, or restore .atm/charter/atomic-charter.md and .atm/charter/charter-invariants.json manually.'
            : failedChecks.includes('onboarding-lifecycle')
                ? onboardingLifecycle.recommendedAction
                : failedChecks.includes('version-compatibility')
                    ? 'node atm.mjs upgrade plan --json'
                    : failedChecks.includes('release-trust')
                        ? 'Reinstall the ATM CLI package from a trusted release or inspect release/integrity.json and compatibility-matrix.json for tampering.'
                        : failedChecks.includes('known-bad-version')
                            ? `Install ATM CLI ${knownBadStatus?.match?.replacementVersion ?? 'replacement version'} and avoid write-oriented commands with the current version.`
                            : failedChecks.includes('git-worktree-readiness')
                                ? gitWorktreeReadiness.recommendedFixCommand ?? 'Repair the local Git worktree readiness before continuing.'
                                : failedChecks.includes('git-head-evidence')
                                    ? 'Record ATM evidence for the current HEAD or review whether work bypassed ATM.'
                                    : failedChecks.includes('governance-entry-readiness')
                                        ? governanceEntryReadiness.details?.recommendedAction ?? 'Review ATM governance readiness hints before editing or pushing framework changes.'
                                        : failedChecks.includes('backlog-sync')
                                            ? 'Review the ATM bug backlog for rows whose status appears to lag behind current source reality, then update the backlog or add the missing validator/documentation closeout.'
                                            : failedChecks.includes('integration-adapters')
                                                ? integrationDriftRemediation.recommendedAction
                                                : failedChecks.includes('framework-integration-hooks')
                                                    ? 'Run node atm.mjs integration hooks install <editor-id> --json, then node atm.mjs git-hooks verify --framework-required --json.'
                                                    : runtime.layoutVersion !== atmLayoutVersion || runtime.migrationNeeded
                                                        ? 'node atm.mjs bootstrap --cwd . --force --task "Bootstrap ATM in this repository"'
                                                        : 'npm run validate:full';
    const messages = [
        ...versionWarnings,
        ...(runnerSourceDrift.syncRequired
            ? [message('warning', 'ATM_RUNNER_SOURCE_DRIFT', runnerSourceDrift.advisory, runnerSourceDrift)]
            : []),
        ...(integrationInstallHint
            ? [message('warning', 'ATM_DOCTOR_INTEGRATION_INSTALL_RECOMMENDED', integrationInstallHint.text, integrationInstallHint.data)]
            : []),
        ...(runtimeAdapterReadiness.needsRuntimeAdapterHint
            ? [message('warning', 'ATM_PYTHON_RUNTIME_ADAPTER_RECOMMENDED', runtimeAdapterReadiness.suggestedAction ?? 'Python entrypoints were detected. Select a Python runtime adapter/plugin before expecting ATM atom birth or apply routes to mutate Python surfaces.', {
                    detectedLanguages: runtimeAdapterReadiness.detectedLanguages,
                    bundledLanguageAdapters: runtimeAdapterReadiness.bundledLanguageAdapters,
                    bundledProjectAdapters: runtimeAdapterReadiness.bundledProjectAdapters,
                    pythonLanguageAdapterAvailable: runtimeAdapterReadiness.pythonLanguageAdapterAvailable,
                    candidateRankingAllowed: runtimeAdapterReadiness.candidateRankingAllowed,
                    atomBirthApplyDeferred: runtimeAdapterReadiness.atomBirthApplyDeferred,
                    missingCapability: runtimeAdapterReadiness.missingCapability
                })]
            : []),
        ...(gitHeadEvidenceCheck.details?.downgradedToWarning
            ? [message('warning', 'ATM_DOCTOR_GIT_EVIDENCE_WARNING', 'Latest Git commit has no matching ATM git-head evidence. This is a warning; same-commit governed provenance and high-risk closeout evidence remain the strict boundaries.', {
                    failedChecks: [],
                    enforcement: gitHeadEvidenceCheck.details.enforcement,
                    commitSha: gitHeadEvidenceCheck.details.commitSha ?? null,
                    recommendedAction: 'Run node atm.mjs evidence git-head-backfill --actor <id> --reason "<reason>" --json when you need a traceable repair record.'
                })]
            : []),
        ...(gitHeadEvidenceCheck.details?.status === 'skipped'
            ? [message('warning', 'ATM_DOCTOR_CHECK_SKIPPED', 'Doctor skipped git-head-evidence for an explicit CI profile or --skip-check policy. Other doctor checks remain enforced.', {
                    skippedCheck: 'git-head-evidence',
                    ciProfile: doctorPolicy.ciProfile,
                    skipChecks: doctorPolicy.skipChecks,
                    originalStatus: gitHeadEvidenceCheck.details.originalStatus ?? null
                })]
            : []),
        ...(!governanceEntryReadiness.ok
            ? [message('warning', 'ATM_DOCTOR_GOVERNANCE_ENTRY_NOT_READY', 'ATM detected a governance readiness blocker that should be resolved before a protected push or governed framework commit.', governanceEntryReadiness.details)]
            : []),
        ...(!backlogSyncCheck.ok
            ? [message('warning', 'ATM_DOCTOR_BACKLOG_SYNC_DRIFT', 'ATM found backlog rows whose status may lag behind current source or validator reality.', backlogSyncCheck.details)]
            : []),
        ...(ok
            ? [message('info', 'ATM_DOCTOR_OK', 'ATM engineering and runtime signals are ready.')]
            : failedChecks.includes('charter-integrity')
                ? [message('error', 'ATM_DOCTOR_CHARTER_MISSING', 'AtomicCharter files are missing or corrupt. Repair before continuing.', { failedChecks })]
                : failedChecks.includes('onboarding-lifecycle')
                    ? [message('error', 'ATM_DOCTOR_ONBOARDING_STALE', 'Onboarding ATMChart sources are missing or stale. Refresh the first-touch artifacts before continuing.', { failedChecks })]
                    : failedChecks.includes('version-compatibility')
                        ? [message('error', 'ATM_DOCTOR_UNSUPPORTED_CHART_VERSION', 'ATMChart/framework/template versions are outside the supported release train.', { failedChecks, versionStatus: versionSummary.compatibility.code })]
                        : failedChecks.includes('release-trust')
                            ? [message('error', 'ATM_DOCTOR_RELEASE_TRUST_FAILED', 'Bundled release integrity hashes do not match expected values.', { failedChecks, trustMode: trustIntegrity?.mode })]
                            : failedChecks.includes('known-bad-version')
                                ? [message('error', 'ATM_DOCTOR_KNOWN_BAD_VERSION', 'This ATM CLI version is listed in known-bad-versions.json.', {
                                        failedChecks,
                                        currentVersion: knownBadStatus?.currentVersion ?? null,
                                        replacementVersion: knownBadStatus?.match?.replacementVersion ?? null,
                                        reasonSummary: knownBadStatus?.match?.reasonSummary ?? null,
                                        severity: knownBadStatus?.match?.severity ?? null
                                    })]
                                : failedChecks.includes('git-worktree-readiness')
                                    ? [message('error', 'ATM_DOCTOR_GIT_WORKTREE_BARE_MISMATCH', 'Git local config marks this checked-out repository as bare, so worktree-backed ATM commands will fail until the local setting is repaired.', {
                                            failedChecks,
                                            status: gitWorktreeReadiness.status,
                                            worktreeRoot: gitWorktreeReadiness.worktreeRoot,
                                            gitDir: gitWorktreeReadiness.gitDir,
                                            recommendedFixCommand: gitWorktreeReadiness.recommendedFixCommand
                                        })]
                                    : failedChecks.includes('git-head-evidence')
                                        ? [message('error', 'ATM_DOCTOR_GIT_EVIDENCE_MISSING', 'Latest Git commit has no matching ATM evidence; work may have bypassed ATM.', { failedChecks })]
                                        : failedChecks.includes('governance-entry-readiness')
                                            ? [message('error', 'ATM_DOCTOR_FAILED', 'ATM engineering or runtime signals need attention.', { failedChecks })]
                                            : failedChecks.includes('backlog-sync')
                                                ? [message('error', 'ATM_DOCTOR_FAILED', 'ATM engineering or runtime signals need attention.', { failedChecks })]
                                                : failedChecks.includes('integration-adapters')
                                                    ? [message('error', 'ATM_DOCTOR_INTEGRATION_DRIFT', 'Installed integration adapter manifests have missing, drifted, or stale files.', {
                                                            failedChecks,
                                                            remediation: integrationDriftRemediation
                                                        })]
                                                    : failedChecks.includes('cross-task-mutation-incident')
                                                        ? [message('error', 'ATM_CROSS_TASK_MUTATION_BLOCKED', 'Cross-task mutation incident detected: files owned by another active task or evidence have been modified, deleted, or staged. ATM has entered incident-safe mode.', {
                                                                failedChecks,
                                                                incident: readIncidentFlag(root),
                                                                conflict: detectCrossTaskMutation(root, runtime.currentTaskId ?? null, 'doctor')
                                                            })]
                                                        : failedChecks.includes('framework-integration-hooks')
                                                            ? [message('error', 'ATM_DOCTOR_FRAMEWORK_HOOKS_MISSING', 'ATM framework repository is missing mandatory editor or Git hook gates.', { failedChecks, frameworkHookReadiness })]
                                                            : [message('error', 'ATM_DOCTOR_FAILED', 'ATM engineering or runtime signals need attention.', { failedChecks })])
    ];
    // Report stale framework locks without deleting runtime state automatically.
    const staleLocks = detectFrameworkStaleLocks(root);
    for (const stale of staleLocks) {
        messages.push(message('warning', 'ATM_DOCTOR_FRAMEWORK_STALE_LOCK', `Stale framework-mode lock detected for actor ${stale.actorId}.`, {
            kind: stale.kind,
            lockTaskId: stale.lockTaskId,
            actorId: stale.actorId,
            lockedAt: stale.lockedAt,
            linkedTaskId: stale.linkedTaskId,
            requiredCommand: stale.requiredCommand
        }));
    }
    return makeResult({
        ok,
        command: 'doctor',
        cwd: root,
        messages,
        evidence: {
            checks,
            packageManager: 'npm',
            packageCount: packageDirs.length,
            repository: relativePathFrom(root, root) || '.',
            projectRole: repoIdentity.isFrameworkRepo ? 'framework' : 'host',
            repoIdentity,
            layoutVersion: runtime.layoutVersion,
            currentTaskId: runtime.currentTaskId,
            lockOwner: runtime.activeLock?.owner ?? null,
            activeLockPath: runtime.activeLock?.path ?? null,
            lastEvidenceAt: runtime.lastEvidenceAt,
            lastHandoffAt: runtime.lastHandoffAt,
            missingPaths: runtime.missingPaths,
            migrationNeeded: runtime.migrationNeeded,
            versionSummary,
            runnerSourceDrift,
            integrationBootstrap,
            integrationDriftRemediation: integrationDriftRemediation.failedAdapters.length > 0 ? integrationDriftRemediation : undefined,
            frameworkHookReadiness,
            gitWorktreeReadiness,
            governanceEntryReadiness: governanceEntryReadiness.details,
            backlogSync: backlogSyncCheck.details,
            runtimeAdapterReadiness,
            trustIntegrity: trustMode ? trustIntegrity : undefined,
            knownBadStatus: knownBadMode ? knownBadStatus : undefined,
            doctorPolicy,
            recommendedAction,
            ...(staleLocks.length > 0 ? { staleLocks } : {})
        }
    });
}
