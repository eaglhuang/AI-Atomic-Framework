import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createValidator } from './lib/validator-harness.ts';

const harness = createValidator('git-stale-remote-artifacts', {
  argv: process.argv.slice(2),
  defaultMode: 'validate'
});

const sourceDir = harness.repoPath('.atm', 'history', 'evidence', 'git-boundary-runs');
const targetDir = harness.repoPath('artifacts', 'git-admit-stale-remote', '20260628');

const summary = JSON.parse(readFileSync(path.join(sourceDir, 'git-boundary-paper-evidence.json'), 'utf8')) as {
  liveCliRuns: Array<{ scenarioId: string; outcome: string; notes?: string[] }>;
};
const markdown = readFileSync(path.join(sourceDir, 'git-boundary-paper-evidence.md'), 'utf8');

mkdirSync(targetDir, { recursive: true });

const resultRows = summary.liveCliRuns.map((run) => ({
  scenarioId: run.scenarioId,
  outcome: run.outcome
}));

writeFileSync(path.join(targetDir, 'summary.json'), `${JSON.stringify({
  schemaId: 'atm.gitStaleRemoteSummary.v1',
  generatedAt: new Date().toISOString(),
  scenarioCount: resultRows.length,
  outcomes: resultRows
}, null, 2)}\n`, 'utf8');
writeFileSync(path.join(targetDir, 'results.jsonl'), `${resultRows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
writeFileSync(path.join(targetDir, 'paper-safe-summary.md'), `${markdown}\n\nPaper wording: local Git boundary / pre-push evidence only; no server-side enforcement claim.\n`, 'utf8');

const hash = (name: string) => createHash('sha256').update(readFileSync(path.join(targetDir, name))).digest('hex');
writeFileSync(
  path.join(targetDir, 'artifact-hash-manifest.sha256'),
  ['summary.json', 'results.jsonl', 'paper-safe-summary.md']
    .map((name) => `${hash(name)}  ${name}`)
    .join('\n') + '\n',
  'utf8'
);

harness.assert(resultRows.length >= 5, 'stale-remote artifact bundle must include the five paper scenarios');
harness.ok(`scenarios=${resultRows.length}`);
