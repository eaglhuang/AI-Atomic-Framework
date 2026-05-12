import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  createContinuationRunReport,
  createContinuationSummaryRecord,
  createLocalGovernanceAdapter,
  estimateContextBudgetTokens
} from '../../../plugin-governance-local/src/index.ts';
import { createTempWorkspace } from '../../../../scripts/temp-root.mjs';
import { runBootstrap } from './bootstrap-entry.mjs';
import { createAgentConfidenceEvidence, resolveAgentProfile, verifyAgentsMarkdown } from './agent-confidence.mjs';
import { bootstrapTaskId, detectGovernanceRuntime } from './governance-runtime.mjs';
import { runInit } from './init.mjs';
import { runHelloWorldSmoke } from './test.mjs';
import { runVerify } from './verify.mjs';
import { CliError, makeResult, message, parseOptions, relativePathFrom } from './shared.mjs';
const repoCopyEntries = [
  'atm.mjs',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'docs',
  'examples',
  'eslint.config.mjs',
  'package.json',
  'package-lock.json',
  'packages',
  'schemas',
  'scripts',
  'templates',
  'tests',
  'tsconfig.build.json',
  'tsconfig.json',
  'turbo.json'
];

export async function runSelfHostAlphaAsync(argv) {
  const { options } = parseOptions(argv, 'self-host-alpha');
  if (!options.verify) {
    throw new CliError('ATM_CLI_USAGE', 'self-host-alpha requires --verify', { exitCode: 2 });
  }
  const agentProfile = options.agent ? resolveAgentProfile(options.agent) : null;
  if (options.agent && !agentProfile) {
    throw new CliError('ATM_CLI_USAGE', `self-host-alpha does not support unknown agent profile: ${options.agent}`, { exitCode: 2 });
  }

  const tempRoot = createTempWorkspace('atm-self-host-alpha-');
  try {
    const sandbox = path.join(tempRoot, 'repo');
    mkdirSync(sandbox, { recursive: true });
    copyRepositorySubset(options.cwd, sandbox);

    const initDryRun = runInit(['--cwd', sandbox, '--adopt', '--dry-run', '--json']);
    const criteria1 = initDryRun.ok === true && typeof initDryRun.evidence?.adoptedAt === 'string';

    const bootstrap = runBootstrap(['--cwd', sandbox, '--task', 'Bootstrap ATM self-hosting alpha']);
    const bootstrapEvidence = evaluateBootstrapEvidence(sandbox);
    const criteria2 = bootstrap.ok === true && bootstrapEvidence.ok;

    const helloWorld = await runHelloWorldSmoke(sandbox);
    const criteria3 = helloWorld.ok === true && helloWorld.passCount === 5 && helloWorld.total === 5;

    const neutrality = runVerify(['--cwd', sandbox, '--neutrality']);
    const criteria4 = neutrality.ok === true;
    const agentsMd = verifyAgentsMarkdown(sandbox);

    const criteria = { criteria1, criteria2, criteria3, criteria4 };
    const ok = Object.values(criteria).every((value) => value === true);
    const selfHostingArtifacts = materializeSelfHostingArtifacts(sandbox, bootstrapEvidence, helloWorld, neutrality, criteria, ok);
    const readinessWarnings = [
      'version-history readiness is advisory for alpha0',
      'rollback readiness is advisory for alpha0',
      'evolution metrics readiness is advisory for alpha0'
    ];
    const confidence = agentProfile
      ? createAgentConfidenceEvidence(agentProfile, criteria, agentsMd)
      : null;

    return {
      ...makeResult({
        ok,
        command: 'self-host-alpha',
        cwd: options.cwd,
        messages: [
          ok
            ? message('info', 'ATM_SELF_HOST_ALPHA_OK', 'Self-hosting alpha deterministic criteria passed.')
            : message('error', 'ATM_SELF_HOST_ALPHA_FAILED', 'Self-hosting alpha deterministic criteria failed.', criteria),
          ...(confidence
            ? [message('warning', 'ATM_SELF_HOST_ALPHA_CONFIDENCE_ADVISORY', 'Multi-agent confidence is advisory and does not block alpha0 release.', {
              agentId: confidence.agentId,
              confidenceReady: confidence.confidenceReady,
              blockers: confidence.blockers
            })]
            : []),
          message('warning', 'ATM_SELF_HOST_ALPHA_READINESS_ADVISORY', 'Evolution readiness checks are advisory and do not block alpha0.', { readinessWarnings })
        ],
        evidence: {
          criteria,
          initDryRun: {
            exitCode: initDryRun.ok ? 0 : 1,
            adoptedAt: initDryRun.evidence?.adoptedAt ?? null
          },
          bootstrap: bootstrapEvidence,
          helloWorld: {
            passCount: helloWorld.passCount,
            total: helloWorld.total,
            checks: helloWorld.checks
          },
          selfHostingArtifacts,
          neutrality: {
            exitCode: neutrality.ok ? 0 : 1,
            violationCount: (neutrality.evidence?.termViolations ?? 0) + (neutrality.evidence?.pathViolations ?? 0)
          },
          agentsMd,
          confidence,
          readinessWarnings,
          sandboxRelativePath: relativePathFrom(tempRoot, sandbox)
        }
      }),
      ...(agentProfile ? { agent: agentProfile.id } : {}),
      ...criteria
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function copyRepositorySubset(sourceRoot, targetRoot) {
  for (const entry of repoCopyEntries) {
    const source = path.join(sourceRoot, entry);
    if (existsSync(source)) {
      cpSync(source, path.join(targetRoot, entry), { recursive: true });
    }
  }
}

function evaluateBootstrapEvidence(cwd) {
  const runtime = detectGovernanceRuntime(cwd, bootstrapTaskId);
  const { paths } = runtime;
  const taskPath = path.join(cwd, paths.taskPath);
  const lockPath = path.join(cwd, paths.lockPath);
  const artifactDir = path.join(cwd, paths.directories?.historyArtifacts ?? '.atm/history/artifacts');
  const evidencePath = path.join(cwd, paths.evidencePath);
  const contextBudgetReportPath = path.join(cwd, paths.contextBudgetReportPath);
  const continuationReportPath = path.join(cwd, paths.continuationReportPath);
  const contextSummaryPath = path.join(cwd, paths.contextSummaryPath);
  const contextSummaryMarkdownPath = path.join(cwd, paths.contextSummaryMarkdownPath);
  const checks = [
    { name: 'task-created', passed: existsSync(taskPath), path: relativePathFrom(cwd, taskPath) },
    { name: 'lock-created', passed: existsSync(lockPath), path: relativePathFrom(cwd, lockPath) },
    { name: 'artifact-directory-created', passed: existsSync(artifactDir), path: relativePathFrom(cwd, artifactDir) },
    { name: 'evidence-created', passed: existsSync(evidencePath), path: relativePathFrom(cwd, evidencePath) },
    { name: 'context-budget-report-created', passed: existsSync(contextBudgetReportPath), path: relativePathFrom(cwd, contextBudgetReportPath) },
    { name: 'continuation-report-created', passed: existsSync(continuationReportPath), path: relativePathFrom(cwd, continuationReportPath) },
    { name: 'context-summary-created', passed: existsSync(contextSummaryPath), path: relativePathFrom(cwd, contextSummaryPath) },
    { name: 'context-summary-markdown-created', passed: existsSync(contextSummaryMarkdownPath), path: relativePathFrom(cwd, contextSummaryMarkdownPath) }
  ];
  return {
    ok: checks.every((check) => check.passed),
    checks,
    taskPath: relativePathFrom(cwd, taskPath),
    lockPath: relativePathFrom(cwd, lockPath),
    artifactDir: relativePathFrom(cwd, artifactDir),
    evidencePath: relativePathFrom(cwd, evidencePath),
    contextBudgetReportPath: relativePathFrom(cwd, contextBudgetReportPath),
    continuationReportPath: relativePathFrom(cwd, continuationReportPath),
    contextSummaryPath: relativePathFrom(cwd, contextSummaryPath),
    contextSummaryMarkdownPath: relativePathFrom(cwd, contextSummaryMarkdownPath)
  };
}

function materializeSelfHostingArtifacts(cwd, bootstrapEvidence, helloWorld, neutrality, criteria, ok) {
  const adapter = createLocalGovernanceAdapter({ repositoryRoot: cwd });
  const runtime = detectGovernanceRuntime(cwd, bootstrapTaskId);
  const now = new Date().toISOString();
  const artifactPath = `.atm/history/artifacts/${bootstrapTaskId}/hello-world-smoke.json`;
  const logPath = `.atm/history/logs/${bootstrapTaskId}.log`;
  const phaseBReportId = `self-host-alpha/${bootstrapTaskId}`;
  const phaseBReportPath = `.atm/history/reports/self-host-alpha/${bootstrapTaskId}.json`;
  const evidencePath = `.atm/history/evidence/${bootstrapTaskId}.json`;
  const estimatedTokens = estimateContextBudgetTokens(bootstrapEvidence, helloWorld, criteria, neutrality?.evidence ?? null);
  const budgetEvaluation = adapter.stores.contextBudgetGuard.evaluateBudget({
    budgetId: `self-host-alpha/${bootstrapTaskId}`,
    workItemId: bootstrapTaskId,
    estimatedTokens,
    inlineArtifacts: 2,
    requestedSummary: 'Review the stored self-host-alpha summary and reports instead of replaying the full proof inline.'
  });

  adapter.stores.artifactStore.writeArtifact({
    workItemId: bootstrapTaskId,
    artifactPath,
    artifactKind: 'report',
    producedBy: '@ai-atomic-framework/cli:self-host-alpha',
    createdAt: now,
    contentType: 'application/json'
  }, `${JSON.stringify({
    generatedAt: now,
    helloWorld,
    criteria,
    bootstrap: bootstrapEvidence
  }, null, 2)}\n`);

  adapter.stores.logStore.appendLog(
    bootstrapTaskId,
    `${now} self-host-alpha smoke ${helloWorld.ok ? 'passed' : 'failed'} (${helloWorld.passCount}/${helloWorld.total})`
  );

  adapter.stores.runReportStore.writeRunReport(phaseBReportId, {
    schemaVersion: 'atm.phaseBExitGate.v0.1',
    gate: 'phase-b-exit',
    generatedAt: now,
    passed: ok,
    criteria,
    bootstrap: bootstrapEvidence,
    helloWorld: {
      passCount: helloWorld.passCount,
      total: helloWorld.total,
      checks: helloWorld.checks,
      specPath: helloWorld.specPath,
      sourcePath: helloWorld.sourcePath
    },
    neutrality: {
      ok: neutrality.ok,
      evidence: neutrality.evidence ?? {}
    },
    contextBudget: {
      decision: budgetEvaluation.decision,
      reportPath: budgetEvaluation.reportPath,
      summaryPath: budgetEvaluation.summaryPath ?? null
    }
  });

  adapter.stores.evidenceStore.writeEvidence(bootstrapTaskId, {
    workItemId: bootstrapTaskId,
    evidenceKind: 'validation',
    summary: ok
      ? 'Self-hosting alpha proof generated replayable smoke evidence.'
      : 'Self-hosting alpha proof captured a failing deterministic check.',
    artifactPaths: [artifactPath, phaseBReportPath, budgetEvaluation.reportPath],
    createdAt: now,
    producedBy: '@ai-atomic-framework/cli:self-host-alpha',
    reproducibility: {
      replayable: true,
      replayCommand: ['node', 'atm.mjs', 'self-host-alpha', '--verify', '--json'],
      inputs: ['examples/hello-world/atoms/hello-world.atom.json'],
      expectedArtifacts: [artifactPath, phaseBReportPath, budgetEvaluation.reportPath],
      notes: 'Replay the deterministic self-host-alpha proof inside a fresh sandbox.'
    },
    details: {
      criteria,
      budgetDecision: budgetEvaluation.decision,
      bootstrapContinuationReportPath: bootstrapEvidence.continuationReportPath,
      bootstrapContextSummaryPath: bootstrapEvidence.contextSummaryPath
    }
  });

  const summary = adapter.stores.contextSummaryStore.writeSummary(createContinuationSummaryRecord({
    workItemId: bootstrapTaskId,
    generatedAt: now,
    summaryId: `summary.self-host-alpha.${bootstrapTaskId.toLowerCase()}`,
    summary: ok
      ? 'Self-hosting alpha proof passed and preserved a replayable continuation contract.'
      : 'Self-hosting alpha proof failed and preserved the blocking evidence for follow-up.',
    nextActions: ok
      ? ['Review the phase-B gate report.', 'Inspect the recorded evidence entry.', 'Decide whether alpha0 can advance.']
      : ['Review the failing phase-B gate report.', 'Inspect the recorded smoke artifact and log.', 'Resolve the failing deterministic criteria before retrying.'],
    artifactPaths: [artifactPath, logPath],
    evidencePaths: [evidencePath],
    reportPaths: [phaseBReportPath, budgetEvaluation.reportPath, bootstrapEvidence.continuationReportPath, bootstrapEvidence.contextBudgetReportPath].filter(Boolean),
    authoredBy: '@ai-atomic-framework/cli:self-host-alpha',
    handoffKind: 'self-host-alpha',
    continuationGoal: 'Review the stored phase-B proof and decide whether the self-hosting alpha gate can advance.',
    resumePrompt: 'Read the stored context summary first, then inspect the phase-B exit gate report and evidence record.',
    resumeCommand: ['node', 'atm.mjs', 'self-host-alpha', '--verify', '--json'],
    budgetDecision: budgetEvaluation.decision,
    hardStop: budgetEvaluation.decision === 'hard-stop'
  }));

  return {
    artifactPath,
    logPath,
    evidencePath,
    phaseBReportPath,
    budgetReportPath: budgetEvaluation.reportPath,
    budgetSummaryPath: budgetEvaluation.summaryPath ?? null,
    contextSummaryPath: normalizePortablePath(runtime.paths.contextSummaryPath),
    contextSummaryMarkdownPath: normalizePortablePath(summary.summaryMarkdownPath ?? runtime.paths.contextSummaryMarkdownPath),
    estimatedTokens,
    budgetDecision: budgetEvaluation.decision
  };
}

function normalizePortablePath(value) {
  return String(value || '').replace(/\\/g, '/');
}
