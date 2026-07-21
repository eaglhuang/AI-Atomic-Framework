import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectCommandBackedMatrix } from '../packages/cli/src/commands/broker/replay/command-backed-matrix.ts';
import { selectRuntimeDogfoodTasks } from '../packages/cli/src/commands/broker/replay/implementation.ts';

interface DiagnosticCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly evidence?: unknown;
}

interface DiagnosticReport {
  readonly schemaId: 'atm.plan3EvidenceClosureDiagnostic.v1';
  readonly generatedAt: string;
  readonly cwd: string;
  readonly ok: boolean;
  readonly verdict: 'ready-to-close' | 'remain-open';
  readonly blockers: readonly string[];
  readonly checks: readonly DiagnosticCheck[];
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cwd = process.cwd() || repoRoot;
const requiredIntersection = ['docs/governance/atm-3-replay-evidence.md'];

const checks: DiagnosticCheck[] = [
  dogfoodCandidateCheck(cwd),
  replayCliSurfaceCheck(cwd),
  commandBackedMatrixCheck(cwd),
  formulaMatrixDisclosureCheck(cwd)
];

const blockers = checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`);
const report: DiagnosticReport = {
  schemaId: 'atm.plan3EvidenceClosureDiagnostic.v1',
  generatedAt: new Date().toISOString(),
  cwd,
  ok: blockers.length === 0,
  verdict: blockers.length === 0 ? 'ready-to-close' : 'remain-open',
  blockers,
  checks
};

const jsonRequested = process.argv.includes('--json');
const allowInconclusive = process.argv.includes('--allow-inconclusive');

if (jsonRequested) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Plan 3 evidence closure diagnostic: ${report.verdict}`);
  for (const check of checks) {
    console.log(`- ${check.ok ? 'ok' : 'blocker'} ${check.name}: ${check.detail}`);
  }
}

if (!report.ok && !allowInconclusive) process.exitCode = 1;

function dogfoodCandidateCheck(root: string): DiagnosticCheck {
  const selected = selectRuntimeDogfoodTasks({
    cwd: root,
    requiredIntersection,
    minimum: 2
  });
  return {
    name: 'real-dogfood-registered-candidates',
    ok: selected.length >= 2,
    detail: selected.length >= 2
      ? `found ${selected.length} registered task candidates with declared intersection`
      : `found ${selected.length}/2 registered planned/ready/running task candidates with declared intersection`,
    evidence: {
      requiredIntersection,
      selected
    }
  };
}

function replayCliSurfaceCheck(root: string): DiagnosticCheck {
  const brokerSpecPath = path.join(root, 'packages/cli/src/commands/command-specs/broker.spec.ts');
  const brokerImplementationPath = path.join(root, 'packages/cli/src/commands/broker/implementation.ts');
  const brokerSpec = existsSync(brokerSpecPath) ? readFileSync(brokerSpecPath, 'utf8') : '';
  const brokerImplementation = existsSync(brokerImplementationPath) ? readFileSync(brokerImplementationPath, 'utf8') : '';
  const hasPublicReplayAction = /\breplay\b/.test(brokerSpec) || /supports: .*replay/.test(brokerImplementation);
  return {
    name: 'frozen-cli-replay-surface',
    ok: hasPublicReplayAction,
    detail: hasPublicReplayAction
      ? 'broker replay is exposed as a frozen CLI action'
      : 'no public frozen `node atm.mjs broker replay ...` action is exposed; current replay harness is implementation/test-only',
    evidence: {
      brokerSpecPath: relative(root, brokerSpecPath),
      brokerImplementationPath: relative(root, brokerImplementationPath)
    }
  };
}

function commandBackedMatrixCheck(root: string): DiagnosticCheck {
  const matrix = inspectCommandBackedMatrix(root);
  return {
    name: 'command-backed-420-cell-matrix',
    ok: matrix.cellCount === 420 && matrix.commandBackedCount === 420,
    detail: matrix.cellCount === 420 && matrix.commandBackedCount === 420
      ? 'all 420 cells include command/workload receipt evidence'
      : `${matrix.cellCount} cells found, ${matrix.commandBackedCount}/420 include command/workload receipt evidence`,
    evidence: {
      ...matrix
    }
  };
}

function formulaMatrixDisclosureCheck(root: string): DiagnosticCheck {
  const scriptPath = path.join(root, 'scripts/run-paired-ab-v4.ts');
  const source = existsSync(scriptPath) ? readFileSync(scriptPath, 'utf8') : '';
  const formulaSignals = [
    'const serialBase =',
    'const armFactor =',
    'const throughputFactor =',
    'const costFactor ='
  ].filter((signal) => source.includes(signal));
  return {
    name: 'formula-generated-matrix-disclosed',
    ok: formulaSignals.length > 0,
    detail: formulaSignals.length > 0
      ? 'current paired AB v4 matrix is visibly formula-generated and must not be treated as real workload proof'
      : 'formula-generation signals were not found; inspect whether the matrix source changed',
    evidence: {
      scriptPath: relative(root, scriptPath),
      formulaSignals
    }
  };
}

function relative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}
