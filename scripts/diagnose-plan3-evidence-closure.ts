import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePlan3SemanticClosure } from '../packages/cli/src/commands/broker/replay/closure-policy.ts';
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
  readonly semanticClosure?: unknown;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cwd = process.cwd() || repoRoot;
const requiredIntersection = ['docs/governance/atm-3-replay-evidence.md'];

const semantic = evaluatePlan3SemanticClosure({
  cwd,
  requiredIntersection,
  useLiveEvidence: true
});

const checks: DiagnosticCheck[] = [
  dogfoodCandidateCheck(cwd),
  replayCliSurfaceCheck(cwd),
  commandBackedMatrixCheck(cwd),
  formulaMatrixDisclosureCheck(cwd),
  {
    name: 'semantic-closure-policy',
    ok: semantic.verdict === 'ready-to-close',
    detail: semantic.verdict === 'ready-to-close'
      ? 'semantic closure predicates are satisfied'
      : `remain-open; missing=${semantic.missingLifecycleClasses.join(',') || 'none'}; invariants=${semantic.invariantFindings.map((entry) => entry.code).join(',') || 'none'}`,
    evidence: semantic
  }
];

const blockers = [
  ...checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`),
  ...semantic.blockers
];
const uniqueBlockers = [...new Set(blockers)];
const report: DiagnosticReport = {
  schemaId: 'atm.plan3EvidenceClosureDiagnostic.v1',
  generatedAt: new Date().toISOString(),
  cwd,
  ok: uniqueBlockers.length === 0,
  verdict: uniqueBlockers.length === 0 ? 'ready-to-close' : 'remain-open',
  blockers: uniqueBlockers,
  checks,
  semanticClosure: semantic
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
  let selected: ReturnType<typeof selectRuntimeDogfoodTasks> = [];
  try {
    selected = selectRuntimeDogfoodTasks({
      cwd: root,
      requiredIntersection,
      minimum: 2
    });
  } catch {
    selected = [];
  }
  const present = selected.length >= 2;
  return {
    name: 'real-dogfood-registered-candidates',
    // Missing candidates remain a hard blocker. Present candidates are only availability,
    // so keep ok=true and let semantic-closure-policy own the fail-closed verdict.
    ok: present,
    detail: present
      ? `found ${selected.length} registered task candidates with declared intersection (availability only; not closure proof)`
      : `found ${selected.length}/2 registered planned/ready/running task candidates with declared intersection`,
    evidence: {
      requiredIntersection,
      selected,
      closureNote: 'candidate-availability-is-not-semantic-closure'
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
  const complete = matrix.cellCount === 420 && matrix.commandBackedCount === 420;
  return {
    name: 'command-backed-420-cell-matrix',
    // Missing receipt shapes remain a hard blocker. Complete shapes alone still cannot close;
    // semantic-closure-policy keeps the repository remain-open under fake-green inputs.
    ok: complete,
    detail: complete
      ? 'all 420 cells include command/workload receipt shapes (shape only; not closure proof)'
      : `${matrix.cellCount} cells found, ${matrix.commandBackedCount}/420 include command/workload receipt evidence`,
    evidence: {
      ...matrix,
      closureNote: 'receipt-shape-is-not-semantic-closure'
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
    ok: true,
    detail: formulaSignals.length > 0
      ? 'current paired AB v4 matrix is visibly formula-generated and must not be treated as real workload proof'
      : 'formula-generation signals were not found; inspect whether the matrix source changed',
    evidence: {
      scriptPath: relative(root, scriptPath),
      formulaSignals,
      informationalOnly: true
    }
  };
}

function relative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}
