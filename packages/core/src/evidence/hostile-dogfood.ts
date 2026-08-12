import { createHash } from 'node:crypto';

export const HOSTILE_DOGFOOD_SCHEMA_ID = 'atm.hostileDogfoodReceipt.v1' as const;

export type HostileOutcome = 'recovered' | 'blocked' | 'unknown';

export interface HostileCondition {
  readonly condition: string;
  readonly outcome: HostileOutcome;
  readonly overrideLeaseUsed?: boolean;
  readonly rollbackPreserved?: boolean;
  readonly canonicalWorktreeIntact?: boolean;
}

/** A sealed observation produced by one independently operating lane. */
export interface HostileDogfoodLaneReceipt {
  readonly laneId: string;
  readonly actorId: string;
  readonly receiptDigest: string;
  readonly sealed: boolean;
}

export interface HostileDogfoodInput {
  readonly sealedReceiptDigest: string;
  readonly lanes?: readonly HostileDogfoodLaneReceipt[];
  readonly conditions?: readonly HostileCondition[];
  /**
   * The incident universe is supplied by the caller instead of being hidden in
   * this compiler.  That keeps the receipt reusable for new incident families.
   */
  readonly requiredConditions?: readonly string[];
  readonly minimumIndependentLanes?: number;
}

export interface HostileDogfoodResult {
  readonly schemaId: typeof HOSTILE_DOGFOOD_SCHEMA_ID;
  readonly status: 'proven' | 'blocked';
  readonly conditions: readonly HostileCondition[];
  readonly saturation: {
    readonly recurrenceCount: number;
    readonly conditionCount: number;
    readonly requiredConditionCount: number;
    readonly independentLaneCount: number;
  };
  readonly rollbackPreserved: boolean;
  readonly canonicalWorktreeIntact: boolean;
  readonly diagnostics: readonly string[];
  readonly resultDigest: string;
}

const digest = (value: unknown) =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

const isDigest = (value: string | undefined): boolean => /^sha256:[a-f0-9]{64}$/i.test(value ?? '');

export function compileHostileDogfood(input: HostileDogfoodInput): HostileDogfoodResult {
  const conditions = [...(input.conditions ?? [])].sort((a, b) => a.condition.localeCompare(b.condition));
  const lanes = [...(input.lanes ?? [])].sort((a, b) => a.laneId.localeCompare(b.laneId));
  const requiredConditions = [...new Set(input.requiredConditions ?? [])].sort();
  const minimumIndependentLanes = input.minimumIndependentLanes ?? 2;
  const diagnostics: string[] = [];

  if (!isDigest(input.sealedReceiptDigest)) diagnostics.push('sealed-receipt-missing-or-invalid');
  if (lanes.length < minimumIndependentLanes) diagnostics.push('independent-lane-receipts-missing');

  const laneIds = new Set<string>();
  const actorIds = new Set<string>();
  for (const lane of lanes) {
    if (!lane.laneId) diagnostics.push('lane-id-missing');
    if (!lane.actorId) diagnostics.push(`lane-actor-missing:${lane.laneId || 'unknown'}`);
    if (!isDigest(lane.receiptDigest)) diagnostics.push(`lane-receipt-digest-missing-or-invalid:${lane.laneId || 'unknown'}`);
    if (lane.sealed !== true) diagnostics.push(`lane-receipt-unsealed:${lane.laneId || 'unknown'}`);
    if (laneIds.has(lane.laneId)) diagnostics.push(`lane-id-not-independent:${lane.laneId}`);
    if (actorIds.has(lane.actorId)) diagnostics.push(`lane-actor-not-independent:${lane.actorId}`);
    laneIds.add(lane.laneId);
    actorIds.add(lane.actorId);
  }

  if (!conditions.length) diagnostics.push('hostile-conditions-missing');
  const observedConditions = new Set<string>();
  for (const item of conditions) {
    if (observedConditions.has(item.condition)) diagnostics.push(`duplicate-condition:${item.condition}`);
    observedConditions.add(item.condition);
    if (requiredConditions.length && !requiredConditions.includes(item.condition)) diagnostics.push(`unexpected-condition:${item.condition}`);
    if (item.outcome === 'unknown') diagnostics.push(`unknown-outcome:${item.condition}`);
    if (item.overrideLeaseUsed) diagnostics.push(`override-lease-forbidden:${item.condition}`);
    if (item.rollbackPreserved !== true) diagnostics.push(`rollback-not-preserved:${item.condition}`);
    if (item.canonicalWorktreeIntact !== true) diagnostics.push(`canonical-worktree-not-proven:${item.condition}`);
  }

  for (const requiredCondition of requiredConditions) {
    if (!observedConditions.has(requiredCondition)) diagnostics.push(`required-condition-missing:${requiredCondition}`);
  }

  const rollbackPreserved = conditions.length > 0 && conditions.every((item) => item.rollbackPreserved === true);
  const canonicalWorktreeIntact = conditions.length > 0 && conditions.every((item) => item.canonicalWorktreeIntact === true);
  const status = diagnostics.length ? 'blocked' : 'proven';
  const saturation = {
    recurrenceCount: conditions.filter((item) => item.outcome === 'recovered').length,
    conditionCount: conditions.length,
    requiredConditionCount: requiredConditions.length,
    independentLaneCount: laneIds.size
  };

  return {
    schemaId: HOSTILE_DOGFOOD_SCHEMA_ID,
    status,
    conditions,
    saturation,
    rollbackPreserved,
    canonicalWorktreeIntact,
    diagnostics,
    resultDigest: digest({ sealedReceiptDigest: input.sealedReceiptDigest, lanes, conditions, requiredConditions, minimumIndependentLanes, status, saturation, rollbackPreserved, canonicalWorktreeIntact })
  };
}
