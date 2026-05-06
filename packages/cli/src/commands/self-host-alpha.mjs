import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBootstrap } from './bootstrap-entry.mjs';
import { runInit } from './init.mjs';
import { runHelloWorldSmoke } from './test.mjs';
import { runVerify } from './verify.mjs';
import { CliError, makeResult, message, parseOptions, relativePathFrom } from './shared.mjs';

const bootstrapTaskId = 'BOOTSTRAP-0001';
const repoCopyEntries = [
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'docs',
  'examples',
  'package.json',
  'packages',
  'pnpm-workspace.yaml',
  'schemas',
  'scripts',
  'templates',
  'tests',
  'turbo.json'
];

export async function runSelfHostAlphaAsync(argv) {
  const { options } = parseOptions(argv, 'self-host-alpha');
  if (!options.verify) {
    throw new CliError('ATM_CLI_USAGE', 'self-host-alpha requires --verify', { exitCode: 2 });
  }

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-self-host-alpha-'));
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

    const criteria = { criteria1, criteria2, criteria3, criteria4 };
    const ok = Object.values(criteria).every((value) => value === true);
    const readinessWarnings = [
      'version-history readiness is advisory for alpha0',
      'rollback readiness is advisory for alpha0',
      'evolution metrics readiness is advisory for alpha0'
    ];

    return {
      ...makeResult({
        ok,
        command: 'self-host-alpha',
        cwd: options.cwd,
        messages: [
          ok
            ? message('info', 'ATM_SELF_HOST_ALPHA_OK', 'Self-hosting alpha deterministic criteria passed.')
            : message('error', 'ATM_SELF_HOST_ALPHA_FAILED', 'Self-hosting alpha deterministic criteria failed.', criteria),
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
          neutrality: {
            exitCode: neutrality.ok ? 0 : 1,
            violationCount: (neutrality.evidence?.termViolations ?? 0) + (neutrality.evidence?.pathViolations ?? 0)
          },
          readinessWarnings,
          sandboxRelativePath: relativePathFrom(tempRoot, sandbox)
        }
      }),
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
  const taskPath = path.join(cwd, '.atm', 'tasks', `${bootstrapTaskId}.json`);
  const lockPath = path.join(cwd, '.atm', 'locks', `${bootstrapTaskId}.lock.json`);
  const artifactDir = path.join(cwd, '.atm', 'artifacts');
  const evidencePath = path.join(cwd, '.atm', 'evidence', `${bootstrapTaskId}.json`);
  const checks = [
    { name: 'task-created', passed: existsSync(taskPath), path: relativePathFrom(cwd, taskPath) },
    { name: 'lock-created', passed: existsSync(lockPath), path: relativePathFrom(cwd, lockPath) },
    { name: 'artifact-directory-created', passed: existsSync(artifactDir), path: relativePathFrom(cwd, artifactDir) },
    { name: 'evidence-created', passed: existsSync(evidencePath), path: relativePathFrom(cwd, evidencePath) }
  ];
  return {
    ok: checks.every((check) => check.passed),
    checks,
    taskPath: relativePathFrom(cwd, taskPath),
    lockPath: relativePathFrom(cwd, lockPath),
    artifactDir: relativePathFrom(cwd, artifactDir),
    evidencePath: relativePathFrom(cwd, evidencePath)
  };
}
