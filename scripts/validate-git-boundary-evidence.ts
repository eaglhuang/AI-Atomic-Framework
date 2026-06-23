import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = path.join(root, '.atm-temp-validate-git-boundary-evidence');

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function runNode(args: string[], cwd: string) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8'
  });
}

function writeText(filePath: string, content: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function setupRemoteScenario() {
  const scenarioRoot = path.join(tempRoot, 'scenario');
  const seed = path.join(scenarioRoot, 'seed');
  const remote = path.join(scenarioRoot, 'remote.git');
  const local = path.join(scenarioRoot, 'local');
  rmSync(scenarioRoot, { recursive: true, force: true });
  mkdirSync(seed, { recursive: true });
  runGit(seed, ['init', '--initial-branch=main']);
  runGit(seed, ['config', 'user.name', 'fixture-agent']);
  runGit(seed, ['config', 'user.email', 'fixture-agent@example.com']);
  writeText(path.join(seed, 'README.md'), '# fixture\n');
  runGit(seed, ['add', 'README.md']);
  runGit(seed, ['commit', '-m', 'chore: bootstrap']);
  runGit(seed, ['clone', '--bare', seed, remote]);
  runGit(seed, ['remote', 'add', 'origin', remote]);
  runGit(seed, ['push', '-u', 'origin', 'main']);
  runGit(scenarioRoot, ['clone', remote, local]);
  runGit(local, ['config', 'user.name', 'fixture-agent']);
  runGit(local, ['config', 'user.email', 'fixture-agent@example.com']);
  return { scenarioRoot, seed, remote, local };
}

try {
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });

  const { seed, local } = setupRemoteScenario();
  writeText(path.join(seed, 'data.json'), `${JSON.stringify({ alpha: 1 }, null, 2)}\n`);
  runGit(seed, ['add', 'data.json']);
  runGit(seed, ['commit', '-m', 'feat: add data']);
  runGit(seed, ['push', 'origin', 'main']);

  runGit(local, ['pull', '--ff-only', 'origin', 'main']);
  writeText(path.join(seed, 'data.json'), `${JSON.stringify({ alpha: 2 }, null, 2)}\n`);
  runGit(seed, ['add', 'data.json']);
  runGit(seed, ['commit', '-m', 'feat: remote alpha']);
  runGit(seed, ['push', 'origin', 'main']);

  runGit(local, ['fetch', 'origin', 'main']);
  writeText(path.join(local, 'data.json'), `${JSON.stringify({ alpha: 3 }, null, 2)}\n`);
  runGit(local, ['add', 'data.json']);
  runGit(local, ['commit', '-m', 'feat: local alpha']);

  const runDir = path.join(root, '.atm', 'history', 'evidence', 'git-boundary-runs');
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(runDir, { recursive: true });
  const outputPath = path.join(runDir, 'validate-git-boundary-evidence.json');
  const admit = runNode([
    path.join(root, 'atm.dev.mjs'),
    'git',
    'admit',
    '--cwd', local,
    '--actor', 'fixture-agent',
    '--branch', 'main',
    '--remote', 'origin',
    '--no-fetch',
    '--output-json', outputPath,
    '--json'
  ], root);
  assert.notEqual(admit.status, 0);
  assert.equal(existsSync(outputPath), true);

  const payload = JSON.parse(readFileSync(outputPath, 'utf8')) as { evidence?: { gitBoundaryEvidence?: any } };
  const envelope = payload.evidence?.gitBoundaryEvidence;
  assert.equal(envelope?.schemaId, 'atm.gitBoundaryEvidenceEnvelope.v1');
  assert.equal(envelope?.actorId, 'fixture-agent');
  assert.equal(envelope?.remoteVirtualActorId.startsWith('virtual:git-remote@'), true);
  assert.equal(envelope?.baseCommit.length > 0, true);
  assert.equal(envelope?.localHead.length > 0, true);
  assert.equal(envelope?.remoteHead.length > 0, true);
  assert.deepEqual(envelope?.targetFiles, ['data.json']);
  assert.equal(Array.isArray(envelope?.conflictKeys), true);
  assert.equal(envelope?.lane, 'blocked');
  assert.equal(envelope?.verdict, 'blocked-active-lease');
  assert.equal(envelope?.outcome, 'block');
  assert.equal(typeof envelope?.recommendation, 'string');
  assert.equal(Array.isArray(envelope?.artifactPaths), true);

  const collectOutputDir = path.join(tempRoot, 'collect-output');
  const collect = runNode([
    '--strip-types',
    path.join(root, 'scripts', 'collect-broker-evidence.ts'),
    '--run-dir', path.join(root, '.atm', 'runtime', 'broker-collision-evidence', 'runs'),
    '--output-dir', collectOutputDir,
    '--task-ids', 'n/a'
  ], root);
  assert.equal(collect.status, 0);

  const bundle = JSON.parse(readFileSync(path.join(collectOutputDir, 'broker-evidence-bundle.json'), 'utf8')) as {
    runs?: Array<Record<string, unknown>>;
  };
  const gitBoundaryRow = (bundle.runs ?? []).find((row) => row.vendor === 'git-boundary-admission');
  assert.ok(gitBoundaryRow, 'collector must include git-boundary-admission rows');
  assert.equal(String(gitBoundaryRow?.files).includes('data.json'), true);
  assert.equal(String(gitBoundaryRow?.verdict).includes('block'), true);

  console.log('[validate-git-boundary-evidence] ok');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
