import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inspectCommandBackedMatrix } from './command-backed-matrix.ts';
import { evaluatePlan3SemanticClosure } from './closure-policy.ts';
import { buildPlan3DogfoodOrchestratorEvidence } from './dogfood-orchestrator.ts';

export type Plan3SourceAvailability = 'available' | 'missing' | 'unavailable' | 'invalid';
export type Plan3AggregateVerdict = 'close' | 'remain-open' | 'closeback-pending';
export type Plan3EvidenceDisposition = 'pass' | 'fail' | 'remain-open' | 'closeback-pending' | 'unavailable' | 'inconclusive';

export interface Plan3CanonicalSourceRecord {
  readonly id: string;
  readonly path: string;
  readonly availability: Plan3SourceAvailability;
  readonly digest: string | null;
  readonly disposition: Plan3EvidenceDisposition;
  readonly blockerCount: number;
}

export interface Plan3FinalClosureVerdict {
  readonly schemaId: 'atm.plan3FinalClosureVerdict.v1';
  readonly verdict: Plan3AggregateVerdict;
  readonly queueAction: 'allow-global-close' | 'trip-queue-only';
  readonly generatedAt: string;
  readonly evidenceWindow: {
    readonly cwdDigest: string;
    readonly watermark: string;
    readonly requiredIntersection: readonly string[];
  };
  readonly counters: {
    readonly sourcesTotal: number;
    readonly sourcesAvailable: number;
    readonly sourcesMissing: number;
    readonly blockers: number;
    readonly matrixCells: number;
    readonly commandBackedMatrixCells: number;
  };
  readonly sourceAvailability: readonly Plan3CanonicalSourceRecord[];
  readonly blockers: readonly string[];
  readonly semanticClosure: ReturnType<typeof evaluatePlan3SemanticClosure>;
  readonly immutableHistoryPolicy: {
    readonly historicalTerminalStatusIsSemanticEvidence: false;
    readonly predecessorHistoryReopened: false;
    readonly producerHealthyLabelsTrusted: false;
  };
  readonly digest: string;
}

const DEFAULT_OUTPUT = 'artifacts/generated/atm-plan3-final/verdict.json';

const CANONICAL_SOURCES: readonly { id: string; path: string; required?: boolean }[] = [
  { id: 'task-0237', path: '.atm/history/tasks/ATM-GOV-0237.json' },
  { id: 'task-0238', path: '.atm/history/tasks/ATM-GOV-0238.json' },
  { id: 'task-0244', path: '.atm/history/tasks/ATM-GOV-0244.json' },
  { id: 'task-0253', path: '.atm/history/tasks/ATM-GOV-0253.json' },
  { id: 'task-0265', path: '.atm/history/tasks/ATM-GOV-0265.json' },
  { id: 'validator-governance-verdict', path: 'artifacts/generated/atm-validator-governance-verdict.json' },
  { id: 'command-backed-matrix', path: 'artifacts/generated/atm-ab-v4/cells.json' },
  { id: 'dogfood-orchestrator', path: 'artifacts/generated/atm-plan3-dogfood/orchestrator.json', required: false },
  { id: 'closeback-summary', path: 'artifacts/generated/atm-plan3-closeback/summary.json', required: false },
  { id: 'red-green-summary', path: 'artifacts/generated/atm-plan3-red-green/summary.json', required: false }
];

export function buildPlan3FinalClosureVerdict(input: {
  readonly cwd: string;
  readonly requiredIntersection?: readonly string[];
  readonly generatedAt?: string;
}): Plan3FinalClosureVerdict {
  const cwd = path.resolve(input.cwd);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const requiredIntersection = input.requiredIntersection ?? ['docs/governance/atm-3-replay-evidence.md'];
  const semanticClosure = evaluatePlan3SemanticClosure({
    cwd,
    requiredIntersection,
    useLiveEvidence: true
  });
  const matrix = inspectCommandBackedMatrix(cwd);
  const sourceAvailability = collectCanonicalSources(cwd, semanticClosure);
  const derivedDogfoodReady = sourceAvailability.some((source) => source.id === 'dogfood-orchestrator-derived' && source.disposition === 'pass');
  const sourceBlockers = sourceAvailability
    .filter((source) => isBlockingSource(source, semanticClosure, derivedDogfoodReady))
    .map((source) => `${source.id}:${source.availability}:${source.disposition}`);
  const blockers = [...new Set([
    ...semanticClosure.blockers,
    ...sourceBlockers,
    ...(semanticClosure.status.matchedPerformance === 'proven' || (matrix.cellCount === 420 && matrix.commandBackedCount === 420)
      ? []
      : [`command-backed-420-cell-matrix:${matrix.commandBackedCount}/420`])
  ])];
  const closebackPending = sourceAvailability.some((source) =>
    ['task-0244', 'task-0253', 'task-0265'].includes(source.id)
    && source.availability === 'available'
    && source.disposition !== 'pass'
  );
  const verdict: Plan3AggregateVerdict = blockers.length === 0
    ? 'close'
    : closebackPending
      ? 'closeback-pending'
      : 'remain-open';
  const body = {
    schemaId: 'atm.plan3FinalClosureVerdict.v1' as const,
    verdict,
    queueAction: verdict === 'close' ? 'allow-global-close' as const : 'trip-queue-only' as const,
    generatedAt,
    evidenceWindow: {
      cwdDigest: digestString(cwd),
      watermark: digestString(JSON.stringify({
        requiredIntersection,
        sourceDigests: sourceAvailability.map((source) => [source.id, source.digest]),
        matrix: { cellCount: matrix.cellCount, commandBackedCount: matrix.commandBackedCount },
        semanticDigest: digestString(JSON.stringify(semanticClosure))
      })),
      requiredIntersection: [...requiredIntersection]
    },
    counters: {
      sourcesTotal: sourceAvailability.length,
      sourcesAvailable: sourceAvailability.filter((source) => source.availability === 'available').length,
      sourcesMissing: sourceAvailability.filter((source) => source.availability === 'missing').length,
      blockers: blockers.length,
      matrixCells: matrix.cellCount,
      commandBackedMatrixCells: matrix.commandBackedCount
    },
    sourceAvailability,
    blockers,
    semanticClosure,
    immutableHistoryPolicy: {
      historicalTerminalStatusIsSemanticEvidence: false as const,
      predecessorHistoryReopened: false as const,
      producerHealthyLabelsTrusted: false as const
    }
  };
  return {
    ...body,
    digest: digestString(JSON.stringify(body))
  };
}

export function writePlan3FinalClosureVerdict(input: {
  readonly cwd: string;
  readonly verdict: Plan3FinalClosureVerdict;
  readonly outputPath?: string | null;
}): string {
  const relative = input.outputPath?.trim() || DEFAULT_OUTPUT;
  const absolute = path.resolve(input.cwd, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(input.verdict, null, 2)}\n`, 'utf8');
  return path.relative(input.cwd, absolute).replace(/\\/g, '/');
}

function collectCanonicalSources(cwd: string, semanticClosure: ReturnType<typeof evaluatePlan3SemanticClosure>): Plan3CanonicalSourceRecord[] {
  const records = CANONICAL_SOURCES.map((source) => inspectSource(cwd, source.id, source.path, semanticClosure));
  records.push(inspectSyntheticOrchestrator(cwd));
  return records;
}

function inspectSource(
  cwd: string,
  id: string,
  relativePath: string,
  semanticClosure: ReturnType<typeof evaluatePlan3SemanticClosure>
): Plan3CanonicalSourceRecord {
  const absolute = path.join(cwd, relativePath);
  if (!existsSync(absolute)) {
    return sourceRecord(id, relativePath, 'missing', null, 'unavailable', 1);
  }
  try {
    const raw = readFileSync(absolute, 'utf8');
    const parsed = safeParseJson(raw);
    return sourceRecord(
      id,
      relativePath,
      'available',
      digestString(raw),
      inferDisposition(id, parsed, semanticClosure),
      inferBlockerCount(id, parsed, semanticClosure)
    );
  } catch {
    return sourceRecord(id, relativePath, 'invalid', null, 'unavailable', 1);
  }
}

function inspectSyntheticOrchestrator(cwd: string): Plan3CanonicalSourceRecord {
  try {
    const evidence = buildPlan3DogfoodOrchestratorEvidence({
      cwd,
      requiredIntersection: ['docs/governance/atm-3-replay-evidence.md']
    });
    return sourceRecord('dogfood-orchestrator-derived', '<derived:buildPlan3DogfoodOrchestratorEvidence>', 'available', digestString(JSON.stringify(evidence)), 'pass', 0);
  } catch {
    return sourceRecord('dogfood-orchestrator-derived', '<derived:buildPlan3DogfoodOrchestratorEvidence>', 'unavailable', null, 'unavailable', 1);
  }
}

function inferDisposition(
  id: string,
  parsed: unknown,
  semanticClosure: ReturnType<typeof evaluatePlan3SemanticClosure>
): Plan3EvidenceDisposition {
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  if (id.startsWith('task-')) {
    return record.status === 'done' ? 'pass' : 'closeback-pending';
  }
  if (id === 'validator-governance-verdict') {
    return (record.verdict as { status?: unknown } | undefined)?.status === 'pass' ? 'pass' : 'fail';
  }
  if (id === 'command-backed-matrix') {
    return semanticClosure.status.matchedPerformance === 'proven' ? 'pass' : 'inconclusive';
  }
  if (semanticClosure.verdict !== 'ready-to-close') return 'remain-open';
  return 'pass';
}

function isBlockingSource(
  source: Plan3CanonicalSourceRecord,
  semanticClosure: ReturnType<typeof evaluatePlan3SemanticClosure>,
  derivedDogfoodReady: boolean
): boolean {
  if (source.id === 'dogfood-orchestrator' && derivedDogfoodReady) return false;
  if (source.id === 'command-backed-matrix' && semanticClosure.status.matchedPerformance === 'proven') return false;
  if (source.availability !== 'available') return true;
  return source.disposition !== 'pass';
}

function inferBlockerCount(
  id: string,
  parsed: unknown,
  semanticClosure: ReturnType<typeof evaluatePlan3SemanticClosure>
): number {
  if (id === 'command-backed-matrix') return semanticClosure.blockers.length;
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  if (Array.isArray(record.blockers)) return record.blockers.length;
  if (id.startsWith('task-')) return record.status === 'done' ? 0 : 1;
  if (id === 'validator-governance-verdict') return (record.verdict as { status?: unknown } | undefined)?.status === 'pass' ? 0 : 1;
  return 0;
}

function sourceRecord(
  id: string,
  relativePath: string,
  availability: Plan3SourceAvailability,
  digest: string | null,
  disposition: Plan3EvidenceDisposition,
  blockerCount: number
): Plan3CanonicalSourceRecord {
  return {
    id,
    path: relativePath.replace(/\\/g, '/'),
    availability,
    digest,
    disposition,
    blockerCount
  };
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function digestString(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
