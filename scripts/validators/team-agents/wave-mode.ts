import { planWaves } from '../../../packages/core/src/broker/team-wave-planner.ts';
import { admitWave } from '../../../packages/core/src/broker/team-wave-admission.ts';
import { createTeamWaveEnvelope, validateTeamWaveEnvelope } from '../../../packages/core/src/broker/team-wave-envelope.ts';
import { assertCoordinatorOnly, type WaveRole } from '../../../packages/cli/src/commands/team-wave.ts';
import { fail } from './assertions.ts';
import { waveCard } from './scenario-matrix.ts';

export function validateWaveMode(): void {
  const safePlan = planWaves({ cards: [waveCard({ taskId: 'T-A' }), waveCard({ taskId: 'T-B' })] });
  if (safePlan.waves.length !== 1) fail('wave-mode: safe wave must plan into one wave');
  const safe = admitWave({ members: [{ card: waveCard({ taskId: 'T-A' }) }, { card: waveCard({ taskId: 'T-B' }) }] });
  if (!safe.ok || safe.admitted.length !== 2) fail('wave-mode: safe wave must admit all members');

  const unsafe = admitWave({
    members: [
      { card: waveCard({ taskId: 'T-A', scopePaths: ['s.ts'], deliverables: ['s.ts'] }) },
      { card: waveCard({ taskId: 'T-B', scopePaths: ['s.ts'], deliverables: ['s.ts'] }) }
    ]
  });
  if (unsafe.admitted.length !== 1 || unsafe.rejected.length !== 1) {
    fail('wave-mode: unsafe wave must reject the conflicting member');
  }

  const mixed = admitWave({
    members: [{ card: waveCard({ taskId: 'T-A' }) }, { card: waveCard({ taskId: 'T-B', dependencies: ['T-OPEN'] }) }]
  });
  if (!mixed.admitted.includes('T-A') || !mixed.rejected.some((r) => r.taskId === 'T-B')) {
    fail('wave-mode: mixed wave must admit ready and defer blocked members');
  }

  const env = createTeamWaveEnvelope({
    coordinatorActorId: 'coordinator',
    targetRepo: 'repo-x',
    closureAuthority: 'target_repo',
    waveIndex: 0,
    members: [
      { taskId: 'T-A', workerActorId: null, scopePaths: ['a.ts'], deliverables: ['a.ts'], patchEnvelopeId: null },
      { taskId: 'T-B', workerActorId: null, scopePaths: ['b.ts'], deliverables: ['b.ts'], patchEnvelopeId: null }
    ]
  });
  if (!validateTeamWaveEnvelope(env).ok) fail('wave-mode: clean wave envelope must validate');

  if (!assertCoordinatorOnly('coordinator', 'task-closeout').allowed) {
    fail('wave-mode: coordinator must be allowed to drive closeout');
  }
  const advisoryRoles: WaveRole[] = ['worker', 'validator', 'reviewer'];
  for (const role of advisoryRoles) {
    if (assertCoordinatorOnly(role, 'git-write').allowed) {
      fail(`wave-mode: advisory role ${role} must not be allowed git-write`);
    }
    if (assertCoordinatorOnly(role, 'task-closeout').allowed) {
      fail(`wave-mode: advisory role ${role} must not be allowed task-closeout`);
    }
  }

  console.log('[validate-team-agents] wave-mode checks ok (safe / unsafe / mixed / envelope / roles)');
}
