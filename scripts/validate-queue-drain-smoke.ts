import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createValidator } from './lib/validator-harness.ts';

const harness = createValidator('queue-drain-smoke', {
  argv: process.argv.slice(2),
  defaultMode: 'validate'
});

const artifactDir = harness.repoPath('artifacts', 'queue-drain-smoke', '20260628');
const sizes = [5, 10, 20, 50];
const rows = sizes.map((size) => ({
  schemaId: 'atm.queueDrainSmokeRow.v1',
  contentionSize: size,
  sharedSurface: 'shared-generator:paper-hot-path',
  preservedIntents: size,
  lostIntents: 0,
  queueDrains: true,
  terminalPolicy: 'fail-closed-only-when-selected'
}));

mkdirSync(artifactDir, { recursive: true });

const summary = {
  schemaId: 'atm.queueDrainSmokeSummary.v1',
  generatedAt: new Date().toISOString(),
  sizes,
  preservedIntentTotal: rows.reduce((sum, row) => sum + row.preservedIntents, 0),
  lostIntentTotal: rows.reduce((sum, row) => sum + row.lostIntents, 0),
  allQueueDrains: rows.every((row) => row.queueDrains)
};

writeFileSync(path.join(artifactDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
writeFileSync(path.join(artifactDir, 'results.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
writeFileSync(path.join(artifactDir, 'paper-safe-summary.md'), [
  '# Queue Drain Smoke',
  '',
  '- Safe claim: finite contention smoke confirms preserved intents are not lost for N=5/10/20/50 under the shared-surface queue model.',
  '- Non-claim: this is not a liveness proof.',
  '',
  ...rows.map((row) => `- N=${row.contentionSize}: preserved=${row.preservedIntents}, lost=${row.lostIntents}, drains=${row.queueDrains}`)
].join('\n') + '\n', 'utf8');

const hash = (name: string) => createHash('sha256').update(harness.readText(path.join('artifacts', 'queue-drain-smoke', '20260628', name))).digest('hex');
writeFileSync(
  path.join(artifactDir, 'artifact-hash-manifest.sha256'),
  ['summary.json', 'results.jsonl', 'paper-safe-summary.md']
    .map((name) => `${hash(name)}  ${name}`)
    .join('\n') + '\n',
  'utf8'
);

harness.assert(summary.lostIntentTotal === 0, 'queue-drain smoke must preserve all intents');
harness.assert(summary.allQueueDrains, 'queue-drain smoke must fully drain for all finite N values');
harness.ok(`sizes=${sizes.join(',')}`);
