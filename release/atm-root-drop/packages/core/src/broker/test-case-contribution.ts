/**
 * Broker-managed shared test-case contributions (TASK-SKL-0023).
 *
 * Feature cards may contribute several integration cases through one bounded
 * group resource intent. Concurrent disjoint contributions compose with member
 * attribution; true same-case conflicts queue or revalidate. Running a case
 * grants no edit authority.
 */

export type TestCaseContributionDisposition = 'compose' | 'queue' | 'revalidate';

export interface TestCaseContributionCase {
  readonly caseId: string;
  readonly semanticKey: string;
  readonly coversAcceptance?: readonly string[];
  readonly coversImpactEdges?: readonly string[];
  readonly expectedRedPredicate?: string | null;
  readonly command?: string | null;
  readonly responsibility?: 'task-required' | 'phase-suite' | 'advisory';
}

export interface TestCaseContributionIntent {
  readonly actorId: string;
  readonly taskId: string;
  readonly contributionResourceKey: string;
  readonly targetGroupId: string;
  readonly cases: readonly TestCaseContributionCase[];
}

export interface TestCaseContributionAttribution {
  readonly actorId: string;
  readonly taskId: string;
  readonly contributionResourceKey: string;
  readonly caseIds: readonly string[];
}

export interface TestCaseContributionDecision {
  readonly schemaId: 'atm.testCaseContributionDecision.v1';
  readonly disposition: TestCaseContributionDisposition;
  readonly targetGroupId: string;
  readonly contributionResourceKey: string;
  readonly composedCases: readonly TestCaseContributionCase[];
  readonly attribution: readonly TestCaseContributionAttribution[];
  readonly conflictCaseIds: readonly string[];
  readonly reason: string;
}

function caseFingerprint(entry: TestCaseContributionCase): string {
  return JSON.stringify({
    caseId: entry.caseId,
    semanticKey: entry.semanticKey,
    coversAcceptance: [...(entry.coversAcceptance ?? [])].sort(),
    coversImpactEdges: [...(entry.coversImpactEdges ?? [])].sort(),
    expectedRedPredicate: entry.expectedRedPredicate ?? null,
    command: entry.command ?? null,
    responsibility: entry.responsibility ?? 'task-required'
  });
}

/**
 * Admit one or more feature-card contribution intents for a shared group.
 * Disjoint case ids compose. Identical same-case payloads compose idempotently.
 * Divergent same-case payloads queue (hard conflict) or revalidate (soft drift).
 */
export function admitTestCaseContributions(
  intents: readonly TestCaseContributionIntent[]
): TestCaseContributionDecision {
  if (intents.length === 0) {
    return {
      schemaId: 'atm.testCaseContributionDecision.v1',
      disposition: 'queue',
      targetGroupId: '',
      contributionResourceKey: '',
      composedCases: [],
      attribution: [],
      conflictCaseIds: [],
      reason: 'No contribution intents were supplied.'
    };
  }

  const resourceKeys = new Set(intents.map((intent) => intent.contributionResourceKey));
  const groupIds = new Set(intents.map((intent) => intent.targetGroupId));
  if (resourceKeys.size !== 1 || groupIds.size !== 1) {
    return {
      schemaId: 'atm.testCaseContributionDecision.v1',
      disposition: 'queue',
      targetGroupId: [...groupIds][0] ?? '',
      contributionResourceKey: [...resourceKeys][0] ?? '',
      composedCases: [],
      attribution: [],
      conflictCaseIds: [],
      reason: 'Concurrent contributions must share one contributionResourceKey and targetGroupId; mixed group intents serialize.'
    };
  }

  const targetGroupId = intents[0]!.targetGroupId;
  const contributionResourceKey = intents[0]!.contributionResourceKey;
  const byCaseId = new Map<string, { fingerprint: string; case: TestCaseContributionCase; owners: TestCaseContributionAttribution[] }>();
  const hardConflicts = new Set<string>();
  const softConflicts = new Set<string>();

  for (const intent of intents) {
    if (!intent.cases.length) {
      return {
        schemaId: 'atm.testCaseContributionDecision.v1',
        disposition: 'queue',
        targetGroupId,
        contributionResourceKey,
        composedCases: [],
        attribution: [],
        conflictCaseIds: [],
        reason: `Intent from ${intent.actorId}/${intent.taskId} declares no cases for resource ${contributionResourceKey}.`
      };
    }
    const attribution: TestCaseContributionAttribution = {
      actorId: intent.actorId,
      taskId: intent.taskId,
      contributionResourceKey: intent.contributionResourceKey,
      caseIds: intent.cases.map((entry) => entry.caseId)
    };
    for (const entry of intent.cases) {
      const fingerprint = caseFingerprint(entry);
      const existing = byCaseId.get(entry.caseId);
      if (!existing) {
        byCaseId.set(entry.caseId, {
          fingerprint,
          case: entry,
          owners: [attribution]
        });
        continue;
      }
      if (existing.fingerprint === fingerprint) {
        existing.owners.push(attribution);
        continue;
      }
      if (existing.case.semanticKey === entry.semanticKey) {
        softConflicts.add(entry.caseId);
      } else {
        hardConflicts.add(entry.caseId);
      }
    }
  }

  if (hardConflicts.size > 0) {
    return {
      schemaId: 'atm.testCaseContributionDecision.v1',
      disposition: 'queue',
      targetGroupId,
      contributionResourceKey,
      composedCases: [],
      attribution: [],
      conflictCaseIds: [...hardConflicts].sort(),
      reason: `Same-case contributions conflict on semantic identity for ${[...hardConflicts].sort().join(', ')}; queue for steward arbitration.`
    };
  }

  if (softConflicts.size > 0) {
    return {
      schemaId: 'atm.testCaseContributionDecision.v1',
      disposition: 'revalidate',
      targetGroupId,
      contributionResourceKey,
      composedCases: [],
      attribution: [],
      conflictCaseIds: [...softConflicts].sort(),
      reason: `Same-case contributions drift on sealed payload for ${[...softConflicts].sort().join(', ')}; revalidate before compose.`
    };
  }

  const composedCases = [...byCaseId.values()]
    .map((entry) => entry.case)
    .sort((left, right) => left.caseId.localeCompare(right.caseId));
  const attribution = intents.map((intent) => ({
    actorId: intent.actorId,
    taskId: intent.taskId,
    contributionResourceKey: intent.contributionResourceKey,
    caseIds: intent.cases.map((entry) => entry.caseId)
  }));

  return {
    schemaId: 'atm.testCaseContributionDecision.v1',
    disposition: 'compose',
    targetGroupId,
    contributionResourceKey,
    composedCases,
    attribution,
    conflictCaseIds: [],
    reason: `Composed ${composedCases.length} case(s) for ${contributionResourceKey} with ${attribution.length} member attribution record(s).`
  };
}
