import assert from 'node:assert/strict';
import { createPairedPacket, digest, validatePairedRuns, verifyPacket, type PairedRun } from '../../scripts/lib/external-benchmark/paired-executor.ts';

const base: Omit<PairedRun, 'arm' | 'runId' | 'sessionId' | 'order'> = { pairId: 'p1', seed: 's1', provider: 'provider-x', model: 'model-x', reasoning: 'medium', budget: 10, promptDigest: digest('prompt'), repoDigest: digest('repo'), command: 'run', rawRef: 'external://raw/p1', status: 'completed' };
const runs: PairedRun[] = [
  { ...base, arm: 'atm', runId: 'a1', sessionId: 'session-a', order: 0 },
  { ...base, arm: 'baseline', runId: 'b1', sessionId: 'session-b', order: 1 }
];
assert.equal(validatePairedRuns(runs).length, 0);
assert.ok(verifyPacket(createPairedPacket('pilot', runs), 'pilot').length === 0);
assert.ok(validatePairedRuns([runs[0]]).length > 0);
assert.ok(verifyPacket({ ...createPairedPacket('pilot', runs), packetDigest: 'sha256:' + '0'.repeat(64) }).length > 0);
assert.ok(verifyPacket({ ...createPairedPacket('pilot', runs), runs: runs.map((r) => ({ ...r, rawRef: 'summary:fake' })) }).length > 0);
console.log('external-benchmark-paired-executor ok');
