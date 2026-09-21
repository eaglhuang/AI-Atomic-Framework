import { createHash } from 'node:crypto';

export const PLAN_CLOSEOUT_DASHBOARD_SCHEMA_ID = 'atm.planCloseoutDashboard.v1' as const;
export const FOUR_PLAN_OBJECTIVE_VERDICT_SCHEMA_ID = 'atm.fourPlanObjectiveVerdict.v1' as const;

export type PlanCloseoutLayerId =
  | 'identity'
  | 'time-window'
  | 'authority-digest'
  | 'denominator'
  | 'correctness'
  | 'performance'
  | 'concurrency'
  | 'validation'
  | 'closure'
  | 'backlog'
  | 'governance'
  | 'claims';

export type ObjectiveVerdictStatus = 'verified' | 'not-complete' | 'unknown' | 'conflicting';
export type DashboardReadiness = 'ready' | 'not-ready';

export interface PlanCloseoutRawArtifact {
  readonly path: string;
  readonly digest: string;
  readonly producedBy?: string | null;
}

export interface FourPlanObjectiveRow {
  readonly planId: 'Plan 3.0' | 'Plan 3.1' | 'Plan 3.2' | 'Plan 4.0';
  readonly objectiveId: string;
  readonly status: ObjectiveVerdictStatus;
  readonly evidenceRefs: readonly string[];
  readonly summary?: string | null;
}

export interface FourPlanObjectiveVerdict {
  readonly schemaId: typeof FOUR_PLAN_OBJECTIVE_VERDICT_SCHEMA_ID;
  readonly generatedAt: string;
  readonly expectedDenominators: Readonly<Record<FourPlanObjectiveRow['planId'], number>>;
  readonly observedDenominators: Readonly<Record<FourPlanObjectiveRow['planId'], number>>;
  readonly statusCounts: Readonly<Record<ObjectiveVerdictStatus, number>>;
  readonly rows: readonly FourPlanObjectiveRow[];
  readonly sortedRowDigest: string;
  readonly findings: readonly string[];
  readonly status: DashboardReadiness;
}

export interface PlanCloseoutDashboardInput {
  readonly generatedAt?: string;
  readonly producer: string;
  readonly authorityDigest: string;
  readonly timeWindow: {
    readonly startedAt: string;
    readonly endedAt: string | null;
    readonly watermark: string;
  };
  readonly rawArtifacts: readonly PlanCloseoutRawArtifact[];
  readonly objectiveRows: readonly FourPlanObjectiveRow[];
  readonly validatorLifecycleDigest?: string | null;
  readonly closureDigest?: string | null;
  readonly backlogDigest?: string | null;
  readonly governanceDigest?: string | null;
  readonly claimDigest?: string | null;
}

export interface PlanCloseoutLayer {
  readonly id: PlanCloseoutLayerId;
  readonly status: DashboardReadiness;
  readonly digest: string | null;
  readonly summary: string;
}

export interface PlanCloseoutDashboard {
  readonly schemaId: typeof PLAN_CLOSEOUT_DASHBOARD_SCHEMA_ID;
  readonly generatedAt: string;
  readonly producer: string;
  readonly readOnly: true;
  readonly readiness: DashboardReadiness;
  readonly authorityDigest: string;
  readonly timeWindow: PlanCloseoutDashboardInput['timeWindow'];
  readonly rawArtifacts: readonly PlanCloseoutRawArtifact[];
  readonly rawInputDigest: string;
  readonly layers: readonly PlanCloseoutLayer[];
  readonly objectiveVerdict: FourPlanObjectiveVerdict;
  readonly staleCounterReuse: false;
  readonly blockers: readonly string[];
  readonly digest: string;
}

const EXPECTED_DENOMINATORS: FourPlanObjectiveVerdict['expectedDenominators'] = {
  'Plan 3.0': 17,
  'Plan 3.1': 23,
  'Plan 3.2': 29,
  'Plan 4.0': 17
};

const STATUSES: readonly ObjectiveVerdictStatus[] = ['verified', 'not-complete', 'unknown', 'conflicting'];

export function expectedFourPlanDenominators(): FourPlanObjectiveVerdict['expectedDenominators'] {
  return { ...EXPECTED_DENOMINATORS };
}

export function buildFourPlanObjectiveVerdict(input: {
  readonly generatedAt?: string;
  readonly rows: readonly FourPlanObjectiveRow[];
}): FourPlanObjectiveVerdict {
  const normalizedRows = normalizeObjectiveRows(input.rows);
  const observedDenominators = countByPlan(normalizedRows);
  const findings: string[] = [];
  for (const [planId, expected] of Object.entries(EXPECTED_DENOMINATORS) as [FourPlanObjectiveRow['planId'], number][]) {
    const observed = observedDenominators[planId] ?? 0;
    if (observed !== expected) findings.push(`${planId} denominator expected ${expected}, observed ${observed}`);
  }
  const seen = new Set<string>();
  for (const row of normalizedRows) {
    const key = `${row.planId}\0${row.objectiveId}`;
    if (seen.has(key)) findings.push(`duplicate objective row: ${row.planId}/${row.objectiveId}`);
    seen.add(key);
    if (!STATUSES.includes(row.status)) findings.push(`invalid objective status: ${row.planId}/${row.objectiveId}`);
    if (row.status === 'verified' && row.evidenceRefs.length === 0) {
      findings.push(`verified row lacks evidence: ${row.planId}/${row.objectiveId}`);
    }
  }
  const statusCounts = Object.fromEntries(STATUSES.map((status) => [
    status,
    normalizedRows.filter((row) => row.status === status).length
  ])) as Record<ObjectiveVerdictStatus, number>;
  const sortedRowDigest = sha256Json(normalizedRows);
  return {
    schemaId: FOUR_PLAN_OBJECTIVE_VERDICT_SCHEMA_ID,
    generatedAt: input.generatedAt ?? new Date(0).toISOString(),
    expectedDenominators: expectedFourPlanDenominators(),
    observedDenominators: {
      'Plan 3.0': observedDenominators['Plan 3.0'] ?? 0,
      'Plan 3.1': observedDenominators['Plan 3.1'] ?? 0,
      'Plan 3.2': observedDenominators['Plan 3.2'] ?? 0,
      'Plan 4.0': observedDenominators['Plan 4.0'] ?? 0
    },
    statusCounts,
    rows: normalizedRows,
    sortedRowDigest,
    findings,
    status: findings.length === 0 ? 'ready' : 'not-ready'
  };
}

export function buildPlanCloseoutDashboard(input: PlanCloseoutDashboardInput): PlanCloseoutDashboard {
  const objectiveVerdict = buildFourPlanObjectiveVerdict({
    generatedAt: input.generatedAt,
    rows: input.objectiveRows
  });
  const rawArtifacts = [...input.rawArtifacts].map((artifact) => ({
    path: normalizePath(artifact.path),
    digest: artifact.digest,
    producedBy: artifact.producedBy ?? null
  })).sort((left, right) => left.path.localeCompare(right.path));
  const rawInputDigest = sha256Json(rawArtifacts);
  const layers: PlanCloseoutLayer[] = [
    layer('identity', Boolean(input.producer), sha256Json({ producer: input.producer }), `producer=${input.producer || 'missing'}`),
    layer('time-window', Boolean(input.timeWindow.startedAt && input.timeWindow.watermark), sha256Json(input.timeWindow), `watermark=${input.timeWindow.watermark || 'missing'}`),
    layer('authority-digest', Boolean(input.authorityDigest), input.authorityDigest || null, input.authorityDigest || 'missing'),
    layer('denominator', objectiveVerdict.status === 'ready', objectiveVerdict.sortedRowDigest, `rows=${objectiveVerdict.rows.length}`),
    layer('correctness', objectiveVerdict.findings.length === 0, objectiveVerdict.sortedRowDigest, objectiveVerdict.findings[0] ?? 'objective matrix is internally consistent'),
    layer('performance', Boolean(input.validatorLifecycleDigest), input.validatorLifecycleDigest ?? null, input.validatorLifecycleDigest ? 'validator lifecycle digest present' : 'validator lifecycle digest unavailable'),
    layer('concurrency', Boolean(input.claimDigest), input.claimDigest ?? null, input.claimDigest ? 'claim digest present' : 'claim digest unavailable'),
    layer('validation', Boolean(input.validatorLifecycleDigest), input.validatorLifecycleDigest ?? null, input.validatorLifecycleDigest ? 'validation digest present' : 'validation digest unavailable'),
    layer('closure', Boolean(input.closureDigest), input.closureDigest ?? null, input.closureDigest ? 'closure digest present' : 'closure digest unavailable'),
    layer('backlog', Boolean(input.backlogDigest), input.backlogDigest ?? null, input.backlogDigest ? 'backlog digest present' : 'backlog digest unavailable'),
    layer('governance', Boolean(input.governanceDigest), input.governanceDigest ?? null, input.governanceDigest ? 'governance digest present' : 'governance digest unavailable'),
    layer('claims', Boolean(input.claimDigest), input.claimDigest ?? null, input.claimDigest ? 'claim digest present' : 'claim digest unavailable')
  ];
  const blockers = [
    ...objectiveVerdict.findings,
    ...layers.filter((entry) => entry.status !== 'ready').map((entry) => `${entry.id}: ${entry.summary}`),
    ...rawArtifacts.length === 0 ? ['raw artifacts missing'] : []
  ];
  const withoutDigest = {
    schemaId: PLAN_CLOSEOUT_DASHBOARD_SCHEMA_ID,
    generatedAt: input.generatedAt ?? new Date(0).toISOString(),
    producer: input.producer,
    readOnly: true as const,
    readiness: blockers.length === 0 ? 'ready' as const : 'not-ready' as const,
    authorityDigest: input.authorityDigest,
    timeWindow: input.timeWindow,
    rawArtifacts,
    rawInputDigest,
    layers,
    objectiveVerdict,
    staleCounterReuse: false as const,
    blockers
  };
  return { ...withoutDigest, digest: sha256Json(withoutDigest) };
}

function layer(id: PlanCloseoutLayerId, pass: boolean, digest: string | null, summary: string): PlanCloseoutLayer {
  return { id, status: pass ? 'ready' : 'not-ready', digest, summary };
}

function normalizeObjectiveRows(rows: readonly FourPlanObjectiveRow[]): FourPlanObjectiveRow[] {
  return [...rows].map((row) => ({
    planId: row.planId,
    objectiveId: String(row.objectiveId).trim(),
    status: row.status,
    evidenceRefs: [...row.evidenceRefs].map(normalizePath).sort(),
    summary: row.summary ?? null
  })).sort((left, right) => `${left.planId}/${left.objectiveId}`.localeCompare(`${right.planId}/${right.objectiveId}`));
}

function countByPlan(rows: readonly FourPlanObjectiveRow[]): Record<FourPlanObjectiveRow['planId'], number> {
  return rows.reduce((counts, row) => ({ ...counts, [row.planId]: (counts[row.planId] ?? 0) + 1 }), {} as Record<FourPlanObjectiveRow['planId'], number>);
}

function normalizePath(value: string): string {
  return String(value ?? '').replace(/\\/g, '/');
}

function sha256Json(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
