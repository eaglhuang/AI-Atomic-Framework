import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePatchEnvelope } from '../../packages/core/src/broker/index.ts';
import type { PatchEnvelope } from '../../packages/core/src/broker/patch-envelope.ts';
import { runRoute } from '../../packages/cli/src/commands/route.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempDir = path.resolve(root, '.atm-temp-route-patch-envelope-handoff');

try {
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  const routeId = 'route-TASK-MAO-0047-cursor-gpt-5.2';
  const open = await runRoute([
    'open',
    '--cwd', tempDir,
    '--route-id', routeId,
    '--task', 'TASK-MAO-0047',
    '--actor', 'cursor-gpt-5.2',
    '--claim-intent', 'write',
    '--write-set', 'packages/cli/src/commands/route.ts',
    '--read-set', 'packages/core/src/broker/index.ts'
  ]);
  assert.equal(open.ok, true);

  const paused = await runRoute([
    'pause',
    '--cwd', tempDir,
    '--route', routeId,
    '--actor', 'cursor-gpt-5.2',
    '--reason', 'handoff review'
  ]);
  assert.equal(paused.ok, true);

  const pauseHandoff = paused.evidence.patchEnvelopeHandoff as {
    schemaId: string;
    envelopeRef: string;
    envelope: PatchEnvelope;
    validation: { ok: boolean };
    applyOutOfScope: string;
  };
  assert.equal(pauseHandoff.schemaId, 'atm.routePatchEnvelopeHandoff.v1');
  assert.equal(pauseHandoff.validation.ok, true);
  assert.ok(pauseHandoff.applyOutOfScope.includes('worktree apply'));
  assert.equal(pauseHandoff.envelope.mode, 'metadata-only');
  assert.equal(pauseHandoff.envelope.taskId, 'TASK-MAO-0047');
  assert.ok(pauseHandoff.envelope.targetFiles.includes('packages/cli/src/commands/route.ts'));

  const envelopePath = path.join(tempDir, '.atm', 'runtime', 'routes', `${routeId}.patch-envelope.json`);
  assert.equal(existsSync(envelopePath), true, 'pause must persist patch envelope sidecar');
  assert.equal(validatePatchEnvelope(JSON.parse(readFileSync(envelopePath, 'utf8'))).ok, true);

  const routeRecord = JSON.parse(readFileSync(path.join(tempDir, '.atm', 'runtime', 'routes', `${routeId}.json`), 'utf8'));
  assert.equal(routeRecord.patchEnvelopeRef, pauseHandoff.envelopeRef);

  const baselinePath = path.join(tempDir, 'baseline.patch-envelope.json');
  writeFileSync(baselinePath, readFileSync(envelopePath, 'utf8'), 'utf8');

  const handoff = await runRoute([
    'handoff',
    '--cwd', tempDir,
    '--route', routeId,
    '--actor', 'cursor-gpt-5.2',
    '--reason', 'refresh handoff metadata',
    '--patch-envelope-ref', 'baseline.patch-envelope.json'
  ]);
  assert.equal(handoff.ok, true);

  const handoffEvidence = handoff.evidence.patchEnvelopeHandoff as {
    comparison: { equal: boolean; divergences: readonly { field: string }[] } | null;
  };
  assert.ok(handoffEvidence.comparison, 'handoff with --patch-envelope-ref must compare envelopes');
  assert.equal(handoffEvidence.comparison.equal, false);
  assert.ok(handoffEvidence.comparison.divergences.some((entry) => entry.field.startsWith('metadata.')));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('[route-patch-envelope-handoff:cli-test] ok (pause/handoff exercises patch envelope broker handoff)');
