import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { runHashPlaceholderAudit } from './hash-placeholder-audit.ts';
import { computeSha256ForFile } from '../../../core/src/hash-lock/hash-lock.ts';
import { checkStartupKnownBadVersion } from '../startup-known-bad.ts';
import { checkStartupIntegrity, resolveBundledIntegrityRoot } from '../startup-integrity.ts';
import { createATMVersionSummary } from './atm-chart.ts';
import { detectFrameworkRepoIdentity, detectFrameworkStaleLocks } from './framework-development.ts';
import { inspectGitWorktreeReadiness } from './git-worktree-readiness.ts';
import { createGitHeadEvidenceCheck } from './git-head-evidence.ts';
import { atmLayoutVersion, bootstrapTaskId, detectGovernanceRuntime } from './governance-runtime.ts';
import { checkIntegrationHealth, describeIntegrationInstallHint, inspectIntegrationBootstrap } from './integration.ts';
import { inspectRuntimeAdapterReadiness } from './runtime-adapter-readiness.ts';
import { inspectTrackedActorRegistryState } from './actor-registry.ts';
import { CliError, makeResult, message, parseOptions, relativePathFrom } from './shared.ts';

const legacyBehaviorPackageNames = [
  'plugin-behavior-atomize',
  'plugin-behavior-compose',
  'plugin-behavior-dedup-merge',
  'plugin-behavior-evolve',
  'plugin-behavior-expire',
  'plugin-behavior-infect',
  'plugin-behavior-merge',
  'plugin-behavior-polymorphize',
  'plugin-behavior-split',
  'plugin-behavior-sweep',
  'plugin-police-lifecycle'
];

export async function runDoctor(argv: any) {
  const trustMode = Array.isArray(argv) && argv.includes('--trust');
  const knownBadMode = Array.isArray(argv) && argv.includes('--known-bad');
  const doctorModeFlags = new Set(['--trust', '--known-bad']);
  const { options } = parseOptions((trustMode || knownBadMode) ? argv.filter((arg: string) => !doctorModeFlags.has(arg)) : argv, 'doctor');
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
  const hasTsNoCheck = listFiles(path.join(root, 'packages'))
    .concat(listFiles(path.join(root, 'scripts')))
    .filter((filePath: any) => /\.(ts|js|mjs)$/.test(filePath))
    .filter((filePath: any) => !filePath.endsWith(path.join('packages', 'cli', 'src', 'commands', 'doctor.ts')))
    .some((filePath: any) => /^\s*\/\/\s*@ts-nocheck\b/m.test(readFileSync(filePath, 'utf8')));
  const missingDist = packageDirs
    .map((packageDir) => ({ packageDir, js: path.join(root, packageDir, 'dist', 'index.js'), dts: path.join(root, packageDir, 'dist', 'index.d.ts') }))
    .filter((entry) => !existsSync(entry.js) || !existsSync(entry.dts))
    .map((entry) => packageDirLabel(root, entry.packageDir));
  const charterIntegrity = checkCharterIntegrity(root);
  const integrationHealth = await checkIntegrationHealth(root);
  const frameworkHookReadiness = (await import('./integration-hooks.ts')).inspectFrameworkHookReadiness(root);
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
  const versionWarnings = createVersionSummaryMessages(versionSummary);
  const trustIntegrity = trustMode ? checkStartupIntegrity(resolveBundledIntegrityRoot()) : null;
  const knownBadStatus = knownBadMode ? checkStartupKnownBadVersion() : null;
  const rawGitHeadEvidenceCheck = createGitHeadEvidenceCheck(root, runtime);
  const gitHeadEvidenceCheck = applyDoctorPolicyToCheck(
    downgradeAdopterGitHeadEvidenceCheck(rawGitHeadEvidenceCheck, repoIdentity),
    doctorPolicy
  );
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
    createCheck('typescript-build-config', !frameworkContractExpected || (existsSync(path.join(root, 'tsconfig.json')) && existsSync(path.join(root, 'tsconfig.build.json')) && rootPackage.scripts?.build?.includes('tsc')), {
      tsconfig: existsSync(path.join(root, 'tsconfig.json')), buildConfig: existsSync(path.join(root, 'tsconfig.build.json')), buildScript: rootPackage.scripts?.build ?? null
    }),
    createCheck('eslint-lint-config', !frameworkContractExpected || (existsSync(path.join(root, 'eslint.config.mjs')) && rootPackage.scripts?.lint?.includes('eslint')), {
      eslintConfig: existsSync(path.join(root, 'eslint.config.mjs')), lintScript: rootPackage.scripts?.lint ?? null
    }),
    createCheck('package-surface', !frameworkContractExpected || (existsSync(path.join(root, 'packages/plugin-behavior-pack')) && legacyPackages.length === 0), { behaviorPack: existsSync(path.join(root, 'packages/plugin-behavior-pack')), legacyPackages }),
    createCheck('repo-hygiene', presentRootFiles.length === 0 && !existsSync(path.join(root, 'pnpm-workspace.yaml')), {
      forbiddenFiles: bannedRootFiles,
      presentRootFiles,
      pnpmWorkspace: existsSync(path.join(root, 'pnpm-workspace.yaml'))
    }),
    createCheck('typescript-escape-hatches', hasTsNoCheck === false, { hasTsNoCheck }),
    createCheck(
      'package-dist',
      !frameworkContractExpected || missingDist.length === 0 || (repoIdentity.isFrameworkRepo && stableOnefileRunnerAvailable),
      { packageCount: packageDirs.length, missingDist, stableOnefileRunnerAvailable }
    ),
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
    createCheck(
      'framework-integration-hooks',
      frameworkHookReadiness.ok || cleanCheckoutFrameworkHookContractOk,
      { ...frameworkHookReadiness, cleanCheckoutFrameworkHookContractOk }
    ),
    ...(trustMode && trustIntegrity ? [createCheck('release-trust', trustIntegrity.ok, trustIntegrity)] : []),
    ...(knownBadMode && knownBadStatus ? [createCheck('known-bad-version', knownBadStatus.ok, knownBadStatus)] : []),
    createCheck('git-worktree-readiness', gitWorktreeReadiness.ok, gitWorktreeReadiness),
    gitHeadEvidenceCheck,
    governanceEntryReadiness,
    backlogSyncCheck
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
    ...(integrationInstallHint
      ? [message(
        'warning',
        'ATM_DOCTOR_INTEGRATION_INSTALL_RECOMMENDED',
        integrationInstallHint.text,
        integrationInstallHint.data
      )]
      : []),
    ...(runtimeAdapterReadiness.needsRuntimeAdapterHint
      ? [message(
        'warning',
        'ATM_PYTHON_RUNTIME_ADAPTER_RECOMMENDED',
        runtimeAdapterReadiness.suggestedAction ?? 'Python entrypoints were detected. Select a Python runtime adapter/plugin before expecting ATM atom birth or apply routes to mutate Python surfaces.',
        {
          detectedLanguages: runtimeAdapterReadiness.detectedLanguages,
          bundledLanguageAdapters: runtimeAdapterReadiness.bundledLanguageAdapters,
          bundledProjectAdapters: runtimeAdapterReadiness.bundledProjectAdapters,
          pythonLanguageAdapterAvailable: runtimeAdapterReadiness.pythonLanguageAdapterAvailable,
          candidateRankingAllowed: runtimeAdapterReadiness.candidateRankingAllowed,
          atomBirthApplyDeferred: runtimeAdapterReadiness.atomBirthApplyDeferred,
          missingCapability: runtimeAdapterReadiness.missingCapability
        }
      )]
      : []),
    ...(gitHeadEvidenceCheck.details?.downgradedToWarning
      ? [message('warning', 'ATM_DOCTOR_GIT_EVIDENCE_WARNING', 'Latest Git commit has no matching ATM git-head evidence. This is a warning in adopter repositories; framework repositories and protected commit-range gates remain strict.', {
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

function resolveDoctorPolicy(options: any) {
  const supportedProfiles = new Set(['dependency-pr']);
  const supportedSkipChecks = new Set(['git-head-evidence']);
  const ciProfile = typeof options.ciProfile === 'string' && options.ciProfile.trim()
    ? options.ciProfile.trim()
    : null;
  if (ciProfile && !supportedProfiles.has(ciProfile)) {
    throw new CliError('ATM_CLI_USAGE', `doctor does not support CI profile ${ciProfile}`, {
      exitCode: 2,
      details: {
        supportedProfiles: [...supportedProfiles]
      }
    });
  }

  const skipChecks = new Set<string>();
  for (const checkName of options.skipChecks ?? []) {
    const normalized = String(checkName).trim();
    if (!normalized) {
      continue;
    }
    if (!supportedSkipChecks.has(normalized)) {
      throw new CliError('ATM_CLI_USAGE', `doctor does not support skipping check ${normalized}`, {
        exitCode: 2,
        details: {
          supportedSkipChecks: [...supportedSkipChecks]
        }
      });
    }
    skipChecks.add(normalized);
  }
  if (ciProfile === 'dependency-pr') {
    skipChecks.add('git-head-evidence');
  }

  return {
    ciProfile,
    skipChecks: [...skipChecks],
    skipReason: ciProfile === 'dependency-pr'
      ? 'Dependency automation PRs do not produce ATM git-head governance evidence, but other doctor checks still run.'
      : skipChecks.size > 0
        ? 'Explicit doctor --skip-check policy.'
        : null
  };
}

function applyDoctorPolicyToCheck(check: any, policy: ReturnType<typeof resolveDoctorPolicy>) {
  if (!policy.skipChecks.includes(check?.name)) {
    return check;
  }
  return {
    ...check,
    ok: true,
    details: {
      status: 'skipped',
      skippedBy: policy.ciProfile ? 'ci-profile' : 'skip-check',
      ciProfile: policy.ciProfile,
      reason: policy.skipReason,
      originalStatus: check?.details?.status ?? null,
      originalOk: check?.ok === true,
      originalDetails: check?.details ?? null
    }
  };
}

function downgradeAdopterGitHeadEvidenceCheck(check: any, repoIdentity: any) {
  if (repoIdentity?.isFrameworkRepo || check?.ok || check?.details?.status !== 'missing') {
    return check;
  }
  return {
    ...check,
    ok: true,
    details: {
      ...check.details,
      enforcement: 'warning',
      downgradedToWarning: true,
      strictInFrameworkRepo: true
    }
  };
}

function checkOnboardingLifecycle(root: any, runtime: any) {
  const configPresent = existsSync(path.join(root, '.atm', 'config.json'));
  const atmChartPath = path.join(root, '.atm', 'memory', 'atm-chart.md');
  const welcomeLineagePath = path.join(root, '.atm', 'runtime', 'welcome.lineage.json');
  if (!configPresent) {
    return {
      ok: true,
      stage: 'uninstalled',
      atmChartPath: relativePathFrom(root, atmChartPath),
      welcomeLineagePath: relativePathFrom(root, welcomeLineagePath),
      atmChartFreshness: 'not-applicable',
      welcomeRecorded: false,
      recommendedAction: 'node atm.mjs bootstrap --cwd . --task "Bootstrap ATM in this repository"'
    };
  }

  const defaultGuardsPath = path.join(root, runtime.paths.defaultGuardsPath);
  const defaultGuardsPresent = existsSync(defaultGuardsPath);
  const atmChartPresent = existsSync(atmChartPath);
  const welcomeLineage = readJsonIfExists(welcomeLineagePath);
  if (!defaultGuardsPresent) {
    return {
      ok: false,
      stage: 'installed',
      defaultGuardsPath: runtime.paths.defaultGuardsPath,
      atmChartPath: relativePathFrom(root, atmChartPath),
      welcomeLineagePath: relativePathFrom(root, welcomeLineagePath),
      atmChartFreshness: 'guards-missing',
      welcomeRecorded: Boolean(welcomeLineage),
      recommendedAction: 'node atm.mjs bootstrap --cwd . --force --task "Bootstrap ATM in this repository"'
    };
  }

  if (!atmChartPresent) {
    return {
      ok: false,
      stage: 'installed',
      defaultGuardsPath: runtime.paths.defaultGuardsPath,
      atmChartPath: relativePathFrom(root, atmChartPath),
      welcomeLineagePath: relativePathFrom(root, welcomeLineagePath),
      atmChartFreshness: 'missing',
      welcomeRecorded: Boolean(welcomeLineage),
      recommendedAction: 'node atm.mjs atm-chart render --cwd .'
    };
  }

  const atmChartFrontmatter = readATMChartFrontmatter(atmChartPath);
  const currentGuardsHash = computeSha256ForFile(defaultGuardsPath);
  const atmChartFresh = atmChartFrontmatter?.source_guards_sha256 === currentGuardsHash;
  const welcomeRecorded = Boolean(welcomeLineage && typeof welcomeLineage.firstWelcomedAt === 'string');
  return {
    ok: atmChartFresh,
    stage: welcomeRecorded ? 'welcomed' : 'atm-chart-rendered',
    defaultGuardsPath: runtime.paths.defaultGuardsPath,
    atmChartPath: relativePathFrom(root, atmChartPath),
    welcomeLineagePath: relativePathFrom(root, welcomeLineagePath),
    atmChartFreshness: atmChartFresh ? 'fresh' : 'stale',
    recordedSourceGuardsSha256: atmChartFrontmatter?.source_guards_sha256 ?? null,
    currentSourceGuardsSha256: currentGuardsHash,
    welcomeRecorded,
    welcomeCount: Number(welcomeLineage?.welcomeCount ?? 0),
    recommendedAction: atmChartFresh ? 'node atm.mjs welcome --cwd .' : 'node atm.mjs atm-chart render --cwd .'
  };
}

function createVersionSummaryMessages(versionSummary: any) {
  const messages = [];
  for (const warning of versionSummary.compatibilityMatrix?.warnings ?? []) {
    messages.push(message('warning', warning.code, warning.text, {
      lastUpdated: warning.lastUpdated ?? null,
      matrixSource: versionSummary.compatibilityMatrix?.source ?? null
    }));
  }
  if (versionSummary.downgrade?.detected === true) {
    messages.push(message('warning', 'ATM_FRAMEWORK_DOWNGRADE_DETECTED', versionSummary.downgrade.reason, {
      currentFrameworkVersion: versionSummary.downgrade.currentFrameworkVersion,
      lastSeenFrameworkVersion: versionSummary.downgrade.lastSeenFrameworkVersion,
      readOnlyDiagnostic: true,
      cachePath: versionSummary.downgrade.cachePath
    }));
  }
  return messages;
}

function readATMChartFrontmatter(filePath: string): Record<string, any> | null {
  try {
    const content = readFileSync(filePath, 'utf8');
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) {
      return null;
    }
    return Object.fromEntries(match[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separatorIndex = line.indexOf(':');
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        return [key, value.startsWith('{') ? JSON.parse(value) : value];
      }));
  } catch {
    return null;
  }
}

function createCheck(name: any, ok: any, details: any) { return { name, ok: ok === true, details }; }

function createIntegrationDriftRemediation(integrationHealth: any) {
  const failedAdapters = (integrationHealth?.failed ?? []).map((entry: any) => {
    const adapterId = typeof entry.adapterId === 'string' && entry.adapterId.length > 0 ? entry.adapterId : null;
    return {
      adapterId,
      manifestPath: entry.manifestPath ?? null,
      status: entry.status ?? null,
      driftedFiles: Array.isArray(entry.driftedFiles) ? entry.driftedFiles : [],
      verifyCommand: adapterId ? `node atm.mjs integration verify ${adapterId} --json` : null,
      reinstallCommand: adapterId ? `node atm.mjs integration add ${adapterId} --force --json` : null,
      removeCommand: adapterId ? `node atm.mjs integration remove ${adapterId} --json` : null
    };
  });
  const first = failedAdapters.find((entry: any) => entry.adapterId) ?? null;
  return {
    schemaId: 'atm.integrationDriftRemediation.v1',
    failedAdapters,
    recommendedAction: first
      ? `Run ${first.verifyCommand}; if drift is expected, run ${first.reinstallCommand}. If the adapter is obsolete, run ${first.removeCommand}.`
      : 'Run node atm.mjs integration verify <id> --json for each failed adapter, then reinstall or remove the drifted integration manifest.'
  };
}

function readJsonIfExists(filePath: any): Record<string, any> | null { return existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, any> : null; }

function createGovernanceEntryReadinessCheck(root: string, repoIdentity: { isFrameworkRepo: boolean }, gitHeadEvidenceCheck: any) {
  const branch = runGitScalar(root, ['branch', '--show-current']);
  const upstream = branch ? runGitScalar(root, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]) : null;
  const aheadCount = upstream ? Number.parseInt(runGitScalar(root, ['rev-list', '--count', `${upstream}..HEAD`]) ?? '0', 10) || 0 : 0;
  const protectedBranchPatterns = ['main', 'master', 'trunk', 'release/*'];
  const protectedBranchTarget = branch ? isProtectedFrameworkBranchTarget(branch) : false;
  const latestGitHeadStatus = gitHeadEvidenceCheck?.details?.status ?? null;
  const actorRegistryState = inspectTrackedActorRegistryState(root);
  const requiresProtectedPushReadiness = repoIdentity.isFrameworkRepo && protectedBranchTarget && aheadCount > 0;
  const protectedPushReadiness = !repoIdentity.isFrameworkRepo
    ? 'not-applicable'
    : !protectedBranchTarget
      ? 'non-protected-branch'
      : !upstream
        ? 'no-upstream'
        : aheadCount === 0
          ? 'no-ahead-commits'
          : latestGitHeadStatus === 'missing'
            ? 'missing-git-head-evidence'
            : 'ready';
  const ok = protectedPushReadiness !== 'missing-git-head-evidence' && !actorRegistryState.blocking;
  return createCheck('governance-entry-readiness', ok, {
    schemaId: 'atm.governanceEntryReadiness.v1',
    repoRole: repoIdentity.isFrameworkRepo ? 'framework' : 'host',
    currentBranch: branch,
    upstreamRef: upstream,
    aheadCount,
    protectedBranchPatterns,
    protectedBranchTarget,
    requiresProtectedPushReadiness,
    protectedPushReadiness,
    latestGitHeadStatus,
    actorRegistryState,
    queueRetryCodes: ['ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE'],
    branchQueueSummary: 'Governed framework commits may serialize through the branch commit queue and retry on safe HEAD drift instead of surfacing raw Git races.',
    recommendedAction: actorRegistryState.blocking
      ? `Actor registry is a tracked governance surface and currently has unstaged drift at ${actorRegistryState.path}. Stage and commit it with the matching identity/governance change, or restore it before continuing.`
      : protectedPushReadiness === 'missing-git-head-evidence'
      ? 'Generate governed git-head evidence before pushing protected framework history. Run node atm.mjs evidence git-head-backfill --actor <id> --reason "<reason>" --json and rerun doctor or hook pre-push.'
      : protectedPushReadiness === 'no-upstream'
        ? 'Set or fetch the upstream branch before relying on protected push readiness diagnostics.'
        : 'Before editing or pushing framework changes, confirm actor identity, framework claim, doctor readiness, and protected-branch push readiness.'
  });
}

function createBacklogSyncCheck(root: string, repoIdentity: { isFrameworkRepo: boolean }) {
  const backlogPath = path.join(root, 'docs', 'governance', 'atm-bug-and-optimization-backlog.md');
  if (!repoIdentity.isFrameworkRepo || !existsSync(backlogPath)) {
    return createCheck('backlog-sync', true, {
      schemaId: 'atm.backlogSyncCheck.v1',
      backlogPath: relativePathFrom(root, backlogPath),
      suspiciousRows: []
    });
  }
  const suspiciousRows = parseBacklogRows(readFileSync(backlogPath, 'utf8'))
    .filter((row) => row.status === 'Open')
    .filter((row) => /(current source now satisfies|repaired on|closed on|landed in|verified by|regression coverage now lives)/i.test(`${row.evidence} ${row.followUp}`))
    .map((row) => ({
      id: row.id,
      area: row.area,
      status: row.status
    }));
  return createCheck('backlog-sync', suspiciousRows.length === 0, {
    schemaId: 'atm.backlogSyncCheck.v1',
    backlogPath: relativePathFrom(root, backlogPath),
    suspiciousRows,
    recommendedAction: suspiciousRows.length > 0
      ? 'Update the backlog status to match current source reality, or land the missing validator/documentation closeout referenced by the row.'
      : 'Backlog open rows appear consistent with current source reality.'
  });
}

function parseBacklogRows(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^\|\s*(ATM|PROJECT)-BUG-/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 11)
    .map((cells) => ({
      id: cells[0],
      status: cells[5],
      area: cells[6],
      evidence: cells[9],
      followUp: cells[10]
    }));
}

function runGitScalar(cwd: string, args: readonly string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) return null;
  const value = String(result.stdout ?? '').trim();
  return value.length > 0 ? value : null;
}

function isProtectedFrameworkBranchTarget(branch: string) {
  return branch === 'main'
    || branch === 'master'
    || branch === 'trunk'
    || /^release\/.+/.test(branch);
}
function hasRequiredScripts(scripts: Record<string, string> = {}) {
  const required = ['build', 'typecheck', 'lint', 'test', 'validate:quick', 'validate:standard', 'validate:full'];
  return required.every((name) => typeof scripts[name] === 'string' && scripts[name].length > 0);
}
function isFrameworkContractExpected(repoIdentity: { isFrameworkRepo: boolean }) {
  return repoIdentity.isFrameworkRepo === true;
}
function listPackageDirs(root: any): string[] {
  const packagesRoot = path.join(root, 'packages');
  if (!existsSync(packagesRoot)) return [];
  return readdirSync(packagesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => `packages/${entry.name}`).filter((packageDir) => existsSync(path.join(root, packageDir, 'package.json')));
}
function packageDirLabel(root: any, packageDir: any) { return readJsonIfExists(path.join(root, packageDir, 'package.json'))?.name ?? packageDir; }
function listFiles(directory: any): string[] {
  if (!existsSync(directory)) return [];
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listFiles(absolutePath);
    }
    return [absolutePath];
  });
}

function checkCharterIntegrity(root: any): { ok: boolean; charterPath: string; charterInvariantsPath: string; charterPresent: boolean; invariantsPresent: boolean; invariantsParseable: boolean; hashField: string | null } {
  const charterPath = path.join(root, '.atm', 'charter', 'atomic-charter.md');
  const invariantsPath = path.join(root, '.atm', 'charter', 'charter-invariants.json');
  const charterPresent = existsSync(charterPath);
  const invariantsPresent = existsSync(invariantsPath);
  let invariantsParseable = false;
  let hashField: string | null = null;
  if (invariantsPresent) {
    try {
      const parsed = JSON.parse(readFileSync(invariantsPath, 'utf8')) as Record<string, unknown>;
      invariantsParseable = true;
      hashField = typeof parsed.charterHash === 'string' ? parsed.charterHash : null;
    } catch {
      invariantsParseable = false;
    }
  }
  // When .atm/charter/ doesn't exist the project has not adopted the charter yet — not a failure.
  // Only fail when the charter directory exists but files are missing or corrupt.
  const charterDirExists = existsSync(path.join(root, '.atm', 'charter'));
  const ok = !charterDirExists || (charterPresent && invariantsPresent && invariantsParseable);
  return {
    ok,
    charterPath: path.relative(root, charterPath).replace(/\\/g, '/'),
    charterInvariantsPath: path.relative(root, invariantsPath).replace(/\\/g, '/'),
    charterPresent,
    invariantsPresent,
    invariantsParseable,
    hashField
  };
}
