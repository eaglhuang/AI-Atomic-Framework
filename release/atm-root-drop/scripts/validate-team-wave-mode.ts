// TASK-MAO-0033: Team Agents Wave Mode dogfood benchmark. Drives the full wave
// pipeline (plan → admit → envelope → worker reports → evidence slice →
// checkpoint) over realistic fixtures modeled on the broker-format-adapter
// family, and asserts the safe / unsafe / mixed / per-task-slicing /
// close-readiness behaviors end to end. Silent-ish on success, throws on first
// failed assertion. Used as the TASK-MAO-0033 command-backed validator.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planWaves, type WaveCandidateCard } from '../packages/core/src/broker/team-wave-planner.ts';
import { admitWave } from '../packages/core/src/broker/team-wave-admission.ts';
import { createTeamWaveEnvelope, validateTeamWaveEnvelope } from '../packages/core/src/broker/team-wave-envelope.ts';
import { createWorkerReport } from '../packages/core/src/broker/team-worker-report.ts';
import { sliceWaveEvidence, type WaveEvidenceMember } from '../packages/core/src/broker/team-wave-evidence.ts';
import { checkpointWave } from '../packages/core/src/broker/team-wave-checkpoint.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, 'scripts/fixtures/team-wave-mode/wave-scenarios.json');

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`[team-wave-mode:dogfood] FAIL ${msg}`);
    process.exit(1);
  }
}

interface FixtureCard extends WaveCandidateCard {}
interface Scenario {
  readonly name: string;
  readonly expect: {
    readonly wavesAtLeast?: number;
    readonly firstWaveSize?: number;
    readonly admitAll?: boolean;
    readonly admittedCount?: number;
    readonly deferredHasDependency?: boolean;
  };
  readonly cards: FixtureCard[];
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  appendSafePaths: string[];
  scenarios: Scenario[];
};

const byName = new Map(fixture.scenarios.map((s) => [s.name, s]));

// --- Scenario 1: safe wave ---
{
  const s = byName.get('safe-wave')!;
  const plan = planWaves({ cards: s.cards, appendSafePaths: fixture.appendSafePaths });
  assert(plan.waves.length >= (s.expect.wavesAtLeast ?? 1), 'safe-wave: expected at least one wave');
  assert(plan.waves[0].members.length === s.expect.firstWaveSize, 'safe-wave: first wave size mismatch');
  const decision = admitWave({
    members: s.cards.map((card) => ({ card })),
    appendSafePaths: fixture.appendSafePaths
  });
  assert(decision.ok && decision.admitted.length === s.cards.length, 'safe-wave: must admit all members');
}

// --- Scenario 2: unsafe wave (same deliverable) ---
{
  const s = byName.get('unsafe-wave-same-deliverable')!;
  const decision = admitWave({ members: s.cards.map((card) => ({ card })) });
  assert(decision.admitted.length === s.expect.admittedCount, 'unsafe-wave: only first member admitted');
  assert(decision.rejected.length >= 1, 'unsafe-wave: must report a rejection');
  assert(
    decision.rejected[0].categories.includes('cid-conflict') ||
      decision.rejected[0].categories.includes('scope-overlap'),
    'unsafe-wave: rejection must cite a conflict category'
  );
}

// --- Scenario 3: mixed wave (dependency-blocked member) ---
{
  const s = byName.get('mixed-wave-dependency')!;
  const decision = admitWave({ members: s.cards.map((card) => ({ card })) });
  assert(decision.admitted.length === s.expect.admittedCount, 'mixed-wave: one member admitted');
  assert(
    decision.rejected.some((r) => r.categories.includes('dependency')),
    'mixed-wave: deferred member must cite dependency'
  );
}

// --- Scenario 4: per-task evidence slicing + close-readiness on the safe wave ---
{
  const s = byName.get('safe-wave')!;
  const evMembers: WaveEvidenceMember[] = s.cards.map((c) => ({
    taskId: c.taskId,
    scopePaths: c.scopePaths,
    deliverables: c.deliverables
  }));
  const changedFiles = s.cards.flatMap((c) => c.deliverables).concat(fixture.appendSafePaths);
  const evidence = sliceWaveEvidence({
    members: evMembers,
    changedFiles,
    appendSafePaths: fixture.appendSafePaths
  });
  assert(evidence.state === 'done', 'slicing: clean safe wave must slice to done');

  // Build envelope from admitted wave and worker reports, then checkpoint.
  const envelope = createTeamWaveEnvelope({
    coordinatorActorId: 'dogfood-coordinator',
    targetRepo: 'AI-Atomic-Framework',
    closureAuthority: 'target_repo',
    waveIndex: 0,
    members: s.cards.map((c) => ({
      taskId: c.taskId,
      workerActorId: `worker-${c.taskId}`,
      scopePaths: c.scopePaths,
      deliverables: c.deliverables,
      patchEnvelopeId: null,
      executionState: 'done' as const
    }))
  });
  assert(validateTeamWaveEnvelope(envelope).ok, 'slicing: envelope must validate');

  const checkpoint = checkpointWave({
    members: s.cards.map((c) => ({
      taskId: c.taskId,
      report: createWorkerReport({
        taskId: c.taskId,
        workerActorId: `worker-${c.taskId}`,
        executionState: 'done',
        changedFiles: c.deliverables,
        validatorRuns: [{ command: 'npm run typecheck', passed: true }]
      })
    })),
    evidence
  });
  assert(
    checkpoint.closeReadyTaskIds.length === s.cards.length,
    'close-readiness: every done member with clean evidence must be close-ready'
  );
}

// --- Scenario 5: close-readiness gating on a needs-review wave ---
{
  const evidence = sliceWaveEvidence({
    members: [{ taskId: 'TASK-X', scopePaths: ['src/x/'], deliverables: [] }],
    changedFiles: ['src/x/a.ts', 'src/UNOWNED.ts']
  });
  assert(evidence.state === 'needs-review', 'gating: unattributed file must force needs-review');
  const checkpoint = checkpointWave({
    members: [
      {
        taskId: 'TASK-X',
        report: createWorkerReport({
          taskId: 'TASK-X',
          workerActorId: 'w',
          executionState: 'done',
          changedFiles: ['src/x/a.ts'],
          validatorRuns: [{ command: 'npm run typecheck', passed: true }]
        })
      }
    ],
    evidence
  });
  assert(checkpoint.closeReadyTaskIds.length === 0, 'gating: needs-review wave must block all close-readiness');
}

console.log('[team-wave-mode:dogfood] ok (safe / unsafe / mixed / slicing / close-readiness)');
