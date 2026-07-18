import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectRepositoryPhysicalLineBudget, type PhysicalLineBudgetReport } from './validate-physical-line-budget.ts';
import { inspectRftAtomizationMetrics, type RftAtomizationMetricsReport, type RftAtomizationWarning } from './validate-rft-atomization-metrics.ts';

type CandidateSource = 'semantic-warning' | 'physical-hard-violation' | 'physical-soft-warning';
type SkipReason = 'duplicate-existing-card' | 'empty-inventory';

export type RftContinuationCandidate = {
  readonly taskId: string;
  readonly title: string;
  readonly source: CandidateSource;
  readonly sourceKey: string;
  readonly scopePaths: readonly string[];
  readonly deliverables: readonly string[];
  readonly validators: readonly string[];
  readonly rollbackNotes: readonly string[];
  readonly atomizationImpact: readonly string[];
  readonly cardText: string;
  readonly writePath: string | null;
};

export type RftContinuationSkippedCandidate = {
  readonly sourceKey: string;
  readonly source: CandidateSource | 'inventory';
  readonly reason: SkipReason;
  readonly detail: string;
};

export type RftContinuationGenerationReport = {
  readonly ok: boolean;
  readonly schemaId: 'atm.rftContinuationCardGeneration.v1';
  readonly generatedAt: string;
  readonly mode: 'dry-run' | 'write';
  readonly planningRoot: string | null;
  readonly targetRoot: string | null;
  readonly nextProposedTaskId: string;
  readonly duplicateDetection: {
    readonly taskIdsSeen: readonly string[];
    readonly scopeKeysSeen: readonly string[];
  };
  readonly candidateCount: number;
  readonly skippedCandidateCount: number;
  readonly candidates: readonly RftContinuationCandidate[];
  readonly skippedCandidates: readonly RftContinuationSkippedCandidate[];
  readonly lineBudget: {
    readonly ok: boolean;
    readonly hardViolationCount: number;
    readonly softWarningCount: number;
  };
  readonly semanticMetrics: {
    readonly ok: boolean;
    readonly semanticWarningCount: number;
    readonly filesLackingAtomizationOwnership: readonly string[];
  };
  readonly errorCode?: 'ATM_RFT_CONTINUATION_ROOTS_REQUIRED';
  readonly reproduceCommand: string;
};

type ContinuationInventory = {
  readonly semanticWarnings: readonly RftAtomizationWarning[];
  readonly hardViolations: PhysicalLineBudgetReport['hardViolations'];
  readonly softWarnings: PhysicalLineBudgetReport['softWarnings'];
};

export function generateRftContinuationCards(input: {
  readonly cwd?: string;
  readonly planningRoot?: string | null;
  readonly targetRoot?: string | null;
  readonly planningRootExplicit?: boolean;
  readonly targetRootExplicit?: boolean;
  readonly write?: boolean;
  readonly maxCandidates?: number;
  readonly lineBudgetReport?: PhysicalLineBudgetReport;
  readonly semanticMetricsReport?: RftAtomizationMetricsReport;
} = {}): RftContinuationGenerationReport {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const planningRoot = input.planningRoot ? path.resolve(input.planningRoot) : inferPlanningRoot(cwd);
  const targetRoot = input.targetRoot ? path.resolve(input.targetRoot) : cwd;
  const mode = input.write ? 'write' : 'dry-run';
  const lineBudget = input.lineBudgetReport ?? inspectRepositoryPhysicalLineBudget(targetRoot, {
    taskId: 'TASK-RFT-0100',
    gate: 'rft-continuation-card-generation'
  });
  const semanticMetrics = input.semanticMetricsReport ?? inspectRftAtomizationMetrics(targetRoot, {
    taskId: 'TASK-RFT-0100',
    ownerAtomOrMapId: 'atm.rft-continuation-card-generator'
  });
  const duplicateState = collectDuplicateState(planningRoot, targetRoot);
  const nextBase = nextTaskNumber(duplicateState.taskIdsSeen);
  const rootRefusal = mode === 'write' && (!input.planningRootExplicit || !input.targetRootExplicit);
  const skipped: RftContinuationSkippedCandidate[] = [];
  const candidates: RftContinuationCandidate[] = [];
  const inventory = buildInventory(lineBudget, semanticMetrics);

  if (rootRefusal) {
    return buildReport({
      mode,
      planningRoot,
      targetRoot,
      duplicateState,
      candidates,
      skipped,
      lineBudget,
      semanticMetrics,
      nextNumber: nextBase,
      errorCode: 'ATM_RFT_CONTINUATION_ROOTS_REQUIRED'
    });
  }

  if (inventory.length === 0) {
    skipped.push({
      source: 'inventory',
      sourceKey: 'empty-inventory',
      reason: 'empty-inventory',
      detail: 'No semantic warnings, physical hard violations, or physical soft warnings were available for continuation-card authoring.'
    });
  }

  let taskNumber = nextBase;
  for (const item of inventory.slice(0, input.maxCandidates ?? 20)) {
    const sourceKey = `${item.source}:${item.file}`;
    const scopeKey = normalizePath(item.file).toLowerCase();
    if (duplicateState.scopeKeysSeen.has(scopeKey)) {
      skipped.push({
        source: item.source,
        sourceKey,
        reason: 'duplicate-existing-card',
        detail: `Existing RFT planning card or ATM ledger already references ${item.file}.`
      });
      continue;
    }
    const taskId = formatTaskId(taskNumber++);
    const candidate = createCandidate(taskId, item, planningRoot);
    candidates.push(candidate);
    duplicateState.scopeKeysSeen.add(scopeKey);
  }

  if (mode === 'write') {
    for (const candidate of candidates) {
      if (!candidate.writePath) continue;
      mkdirSync(path.dirname(candidate.writePath), { recursive: true });
      writeFileSync(candidate.writePath, candidate.cardText);
    }
  }

  return buildReport({
    mode,
    planningRoot,
    targetRoot,
    duplicateState,
    candidates,
    skipped,
    lineBudget,
    semanticMetrics,
    nextNumber: nextBase
  });
}

function buildInventory(lineBudget: PhysicalLineBudgetReport, semanticMetrics: RftAtomizationMetricsReport): Array<{ readonly source: CandidateSource; readonly file: string; readonly detail: string }> {
  return [
    ...semanticMetrics.semanticWarnings.map((warning) => ({
      source: 'semantic-warning' as const,
      file: warning.file,
      detail: `${warning.code}: ${warning.detail}`
    })),
    ...lineBudget.hardViolations.map((entry) => ({
      source: 'physical-hard-violation' as const,
      file: entry.file,
      detail: `File has ${entry.lines} lines, above hard budget ${lineBudget.maxLines}.`
    })),
    ...lineBudget.softWarnings.map((entry) => ({
      source: 'physical-soft-warning' as const,
      file: entry.file,
      detail: `File has ${entry.lines} lines, above soft budget ${lineBudget.softLines}.`
    }))
  ].sort((left, right) => left.file.localeCompare(right.file) || left.source.localeCompare(right.source));
}

function createCandidate(taskId: string, item: { readonly source: CandidateSource; readonly file: string; readonly detail: string }, planningRoot: string | null): RftContinuationCandidate {
  const slug = slugify(`${item.source}-${path.basename(item.file, path.extname(item.file))}`);
  const title = `RFT continuation for ${item.file}`;
  const writePath = planningRoot
    ? path.join(planningRoot, 'docs/ai_atomic_framework/rft-hardening/tasks', `${taskId}-${slug}.task.md`)
    : null;
  const deliverables = [
    `Review and split or map ${item.file} according to the reported RFT inventory.`,
    'Record line-budget and atomization-metric evidence after the adjustment.',
    'Preserve behavior and avoid claiming or closing this generated card automatically.'
  ];
  const validators = [
    'node --strip-types scripts/validate-physical-line-budget.ts --json',
    'node --strip-types scripts/validate-rft-atomization-metrics.ts --json',
    'npm run typecheck'
  ];
  const rollbackNotes = [
    'Revert only the scoped continuation edits and their ATM evidence if validation fails.',
    'Leave the generator output as review evidence; do not auto-close successor cards.'
  ];
  const atomizationImpact = [
    item.detail,
    'Expected impact: reduce residual RFT follow-up inventory and improve semantic ownership evidence.'
  ];
  const cardText = renderCard({ taskId, title, item, deliverables, validators, rollbackNotes, atomizationImpact });
  return {
    taskId,
    title,
    source: item.source,
    sourceKey: `${item.source}:${item.file}`,
    scopePaths: [item.file],
    deliverables,
    validators,
    rollbackNotes,
    atomizationImpact,
    cardText,
    writePath
  };
}

function renderCard(input: {
  readonly taskId: string;
  readonly title: string;
  readonly item: { readonly source: CandidateSource; readonly file: string; readonly detail: string };
  readonly deliverables: readonly string[];
  readonly validators: readonly string[];
  readonly rollbackNotes: readonly string[];
  readonly atomizationImpact: readonly string[];
}): string {
  const list = (values: readonly string[]) => values.map((value) => `  - ${value}`).join('\n');
  return `---
task_id: ${input.taskId}
title: ${JSON.stringify(input.title)}
status: planned
owner: atm-release
source: ${input.item.source}
scope:
  - ${input.item.file}
deliverables:
${list(input.deliverables)}
validators:
${list(input.validators)}
rollback:
${list(input.rollbackNotes)}
atomization_impact:
${list(input.atomizationImpact)}
---

# ${input.taskId} - ${input.title}

## Objective

Resolve the RFT continuation signal for \`${input.item.file}\` without importing, claiming, or closing successor cards automatically.

## Trigger Evidence

${input.item.detail}

## Acceptance

- Scope, deliverables, validators, rollback notes, and atomization impact are reviewed by a human before import.
- The final implementation preserves behavior and records fresh RFT validation evidence.
- Any generated successor remains a candidate until explicitly imported through ATM governance.
`;
}

function buildReport(input: {
  readonly mode: 'dry-run' | 'write';
  readonly planningRoot: string | null;
  readonly targetRoot: string | null;
  readonly duplicateState: { readonly taskIdsSeen: Set<string>; readonly scopeKeysSeen: Set<string> };
  readonly candidates: readonly RftContinuationCandidate[];
  readonly skipped: readonly RftContinuationSkippedCandidate[];
  readonly lineBudget: PhysicalLineBudgetReport;
  readonly semanticMetrics: RftAtomizationMetricsReport;
  readonly nextNumber: number;
  readonly errorCode?: 'ATM_RFT_CONTINUATION_ROOTS_REQUIRED';
}): RftContinuationGenerationReport {
  return {
    ok: !input.errorCode,
    schemaId: 'atm.rftContinuationCardGeneration.v1',
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    planningRoot: input.planningRoot,
    targetRoot: input.targetRoot,
    nextProposedTaskId: formatTaskId(input.nextNumber),
    duplicateDetection: {
      taskIdsSeen: [...input.duplicateState.taskIdsSeen].sort(),
      scopeKeysSeen: [...input.duplicateState.scopeKeysSeen].sort()
    },
    candidateCount: input.candidates.length,
    skippedCandidateCount: input.skipped.length,
    candidates: input.candidates,
    skippedCandidates: input.skipped,
    lineBudget: {
      ok: input.lineBudget.ok,
      hardViolationCount: input.lineBudget.hardViolationCount,
      softWarningCount: input.lineBudget.softWarningCount
    },
    semanticMetrics: {
      ok: input.semanticMetrics.ok,
      semanticWarningCount: input.semanticMetrics.semanticWarningCount,
      filesLackingAtomizationOwnership: input.semanticMetrics.filesLackingAtomizationOwnership
    },
    errorCode: input.errorCode,
    reproduceCommand: 'node --strip-types scripts/generate-rft-continuation-cards.ts --dry-run --json'
  };
}

function collectDuplicateState(planningRoot: string | null, targetRoot: string | null): { readonly taskIdsSeen: Set<string>; readonly scopeKeysSeen: Set<string> } {
  const taskIdsSeen = new Set<string>();
  const scopeKeysSeen = new Set<string>();
  for (const file of listExistingRftFiles(planningRoot, targetRoot)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/TASK-RFT-\d{4}/g)) taskIdsSeen.add(match[0]);
    for (const match of text.matchAll(/(?:packages|scripts|tests|docs)\/[A-Za-z0-9._/-]+/g)) {
      scopeKeysSeen.add(normalizePath(match[0]).toLowerCase());
    }
  }
  return { taskIdsSeen, scopeKeysSeen };
}

function listExistingRftFiles(planningRoot: string | null, targetRoot: string | null): string[] {
  const files: string[] = [];
  const planningDir = planningRoot ? path.join(planningRoot, 'docs/ai_atomic_framework/rft-hardening/tasks') : null;
  if (planningDir && existsSync(planningDir)) {
    for (const entry of readdirSync(planningDir)) {
      if (/TASK-RFT-\d{4}.*\.task\.md$/.test(entry)) files.push(path.join(planningDir, entry));
    }
  }
  const taskDir = targetRoot ? path.join(targetRoot, '.atm/history/tasks') : null;
  if (taskDir && existsSync(taskDir)) {
    for (const entry of readdirSync(taskDir)) {
      if (/TASK-RFT-\d{4}\.json$/.test(entry)) files.push(path.join(taskDir, entry));
    }
  }
  return files;
}

function nextTaskNumber(taskIds: ReadonlySet<string>): number {
  const numbers = [...taskIds].map((id) => Number(id.replace('TASK-RFT-', ''))).filter(Number.isFinite);
  return Math.max(0, ...numbers) + 1;
}

function formatTaskId(value: number): string {
  return `TASK-RFT-${String(value).padStart(4, '0')}`;
}

function inferPlanningRoot(cwd: string): string | null {
  const candidate = path.resolve(cwd, '..', '3KLife');
  return existsSync(candidate) ? candidate : null;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'continuation';
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function readFlagValue(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

function isMainModule(): boolean {
  return process.argv[1] ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href : false;
}

if (isMainModule()) {
  const argv = process.argv.slice(2);
  const report = generateRftContinuationCards({
    cwd: process.cwd(),
    planningRoot: readFlagValue(argv, '--planning-root'),
    targetRoot: readFlagValue(argv, '--target-root'),
    planningRootExplicit: argv.includes('--planning-root'),
    targetRootExplicit: argv.includes('--target-root'),
    write: argv.includes('--write'),
    maxCandidates: Number(readFlagValue(argv, '--max-candidates') ?? 20)
  });
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(`[rft-continuation-cards] ok=${report.ok} mode=${report.mode} candidates=${report.candidateCount} skipped=${report.skippedCandidateCount} next=${report.nextProposedTaskId}`);
  }
  if (!report.ok) process.exitCode = 1;
}
