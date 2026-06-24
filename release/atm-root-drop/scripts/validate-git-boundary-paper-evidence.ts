import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBoundaryFixtures } from './lib/git-boundary-fixtures.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = path.join(root, '.atm-temp-validate-git-boundary-paper-evidence');
const runDir = path.join(root, '.atm', 'history', 'evidence', 'git-boundary-runs');

type CapturedRun = {
  readonly scenarioId: string;
  readonly command: 'git admit' | 'git recover-push-fail';
  readonly classification: 'live-cli-dogfood';
  readonly outcome: string;
  readonly lane: string | null;
  readonly verdict: string | null;
  readonly baseCommit: string | null;
  readonly localActor: string;
  readonly remoteVirtualActor: string | null;
  readonly targetFiles: readonly string[];
  readonly artifactPaths: readonly string[];
  readonly notes: readonly string[];
};

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

function setupRemoteScenario(name: string) {
  const scenarioRoot = path.join(tempRoot, name);
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

function commitAndPush(cwd: string, message: string, files: Record<string, string>) {
  for (const [relativePath, content] of Object.entries(files)) {
    writeText(path.join(cwd, relativePath), content);
  }
  runGit(cwd, ['add', '--', ...Object.keys(files)]);
  runGit(cwd, ['commit', '-m', message]);
  runGit(cwd, ['push', 'origin', 'main']);
}

function outputPathForScenario(scenarioId: string) {
  return path.join(runDir, `${scenarioId}.json`);
}

function markdownPathForScenario(scenarioId: string) {
  return path.join(runDir, `${scenarioId}.md`);
}

function writeScenarioMarkdown(
  scenarioId: string,
  command: 'git admit' | 'git recover-push-fail',
  payload: { evidence?: Record<string, any> }
) {
  const evidence = payload.evidence ?? {};
  const envelope = (evidence.gitBoundaryEvidence ?? {}) as Record<string, any>;
  const lines = [
    `# ${scenarioId}`,
    '',
    `- command: \`${command}\``,
    `- outcome: \`${String(evidence.outcome ?? envelope.outcome ?? 'unknown')}\``,
    `- lane: \`${typeof envelope.lane === 'string' ? envelope.lane : 'n/a'}\``,
    `- verdict: \`${typeof envelope.verdict === 'string' ? envelope.verdict : 'n/a'}\``,
    `- base commit: \`${typeof envelope.baseCommit === 'string' ? envelope.baseCommit : 'n/a'}\``,
    `- local actor: \`${typeof envelope.actorId === 'string' ? envelope.actorId : 'fixture-agent'}\``,
    `- remote virtual actor: \`${typeof envelope.remoteVirtualActorId === 'string' ? envelope.remoteVirtualActorId : 'n/a'}\``,
    `- target files: ${(Array.isArray(envelope.targetFiles) ? envelope.targetFiles.map(String) : []).join(', ') || 'n/a'}`,
    `- recommendation: ${String(evidence.recommendedNextStep ?? envelope.recommendation ?? 'n/a')}`
  ];
  writeText(markdownPathForScenario(scenarioId), `${lines.join('\n')}\n`);
}

function runGitAdmissionScenario(
  scenarioId: string,
  local: string,
  extraArgs: readonly string[] = []
) {
  const outputPath = outputPathForScenario(scenarioId);
  const args = [
    path.join(root, 'atm.dev.mjs'),
    'git',
    'admit',
    '--cwd', local,
    '--actor', 'fixture-agent',
    '--branch', 'main',
    '--remote', 'origin',
    '--no-fetch',
    ...extraArgs,
    '--output-json', outputPath,
    '--json'
  ];
  const result = runNode(args, root);
  assert.equal(result.status !== null, true);
  const payload = JSON.parse(readFileSync(outputPath, 'utf8')) as { evidence?: Record<string, any> };
  writeScenarioMarkdown(scenarioId, 'git admit', payload);
  return { outputPath, payload, status: result.status ?? 1 };
}

function runGitRecoveryScenario(
  scenarioId: string,
  local: string,
  extraArgs: readonly string[] = []
) {
  const outputPath = outputPathForScenario(scenarioId);
  const args = [
    path.join(root, 'atm.dev.mjs'),
    'git',
    'recover-push-fail',
    '--cwd', local,
    '--actor', 'fixture-agent',
    '--branch', 'main',
    '--remote', 'origin',
    ...extraArgs,
    '--output-json', outputPath,
    '--json'
  ];
  const result = runNode(args, root);
  assert.equal(result.status !== null, true);
  const payload = JSON.parse(readFileSync(outputPath, 'utf8')) as { evidence?: Record<string, any> };
  writeScenarioMarkdown(scenarioId, 'git recover-push-fail', payload);
  return { outputPath, payload, status: result.status ?? 1 };
}

function toCapturedRun(
  scenarioId: string,
  command: 'git admit' | 'git recover-push-fail',
  payload: { evidence?: Record<string, any> },
  notes: readonly string[]
): CapturedRun {
  const evidence = payload.evidence ?? {};
  const gitBoundaryEvidence = (evidence.gitBoundaryEvidence ?? {}) as Record<string, any>;
  return {
    scenarioId,
    command,
    classification: 'live-cli-dogfood',
    outcome: String(evidence.outcome ?? gitBoundaryEvidence.outcome ?? 'unknown'),
    lane: typeof gitBoundaryEvidence.lane === 'string' ? gitBoundaryEvidence.lane : null,
    verdict: typeof gitBoundaryEvidence.verdict === 'string' ? gitBoundaryEvidence.verdict : null,
    baseCommit: typeof gitBoundaryEvidence.baseCommit === 'string' ? gitBoundaryEvidence.baseCommit : null,
    localActor: typeof gitBoundaryEvidence.actorId === 'string' ? gitBoundaryEvidence.actorId : 'fixture-agent',
    remoteVirtualActor: typeof gitBoundaryEvidence.remoteVirtualActorId === 'string' ? gitBoundaryEvidence.remoteVirtualActorId : null,
    targetFiles: Array.isArray(gitBoundaryEvidence.targetFiles) ? gitBoundaryEvidence.targetFiles.map(String) : [],
    artifactPaths: Array.isArray(gitBoundaryEvidence.artifactPaths) ? gitBoundaryEvidence.artifactPaths.map(String) : [],
    notes
  };
}

function buildMarkdownReport(runs: readonly CapturedRun[]) {
  const lines: string[] = [
    '# Git Boundary Paper Evidence',
    '',
    '## Scope',
    '',
    '- Deterministic fixture assertions: `tests/cli/git-admission-cli.test.ts` proves the scenario matrix is covered in repeatable local fixtures.',
    '- Live CLI dogfood: this validator executes `atm.dev.mjs git admit` and `atm.dev.mjs git recover-push-fail` against ephemeral local Git remotes and records the resulting evidence envelopes.',
    '- Limitation: all runs are local-hook / local-repo dogfood. They do not claim server-side enforcement.',
    '',
    '## Live CLI Runs',
    '',
    '| Scenario | Command | Outcome | Lane | Verdict | Target files | Base commit | Artifact paths |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |'
  ];
  for (const run of runs) {
    lines.push(`| ${run.scenarioId} | \`${run.command}\` | \`${run.outcome}\` | \`${run.lane ?? 'n/a'}\` | \`${run.verdict ?? 'n/a'}\` | ${run.targetFiles.join(', ') || 'n/a'} | \`${run.baseCommit ?? 'n/a'}\` | ${run.artifactPaths.join(', ') || 'n/a'} |`);
  }
  lines.push(
    '',
    '## Coverage',
    '',
    '- `allow-remote-local-disjoint`: allow lane with no conflicting files.',
    '- `block-same-record-conflict`: blocked run with conflicting mutation surface.',
    '- `composer-disjoint-records`: composer-routed same-file mergeable case.',
    '- `recover-block-non-fast-forward`: post-push-fail recovery that recommends rebase.',
    '- `recover-composer-non-fast-forward`: post-push-fail recovery that recommends steward follow-up.',
    '',
    '## Limitations',
    '',
    '- MVP remains local-hook based and can be bypassed with local operator actions such as `--no-verify`.',
    '- No server-side enforcement is claimed here; protected branches and CI remain separate deployment policy layers.',
    '- Unsupported file types still fall back conservatively; absence of a format adapter should not be interpreted as semantic merge safety.'
  );
  return `${lines.join('\n')}\n`;
}

try {
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });
  mkdirSync(runDir, { recursive: true });

  const runs: CapturedRun[] = [];

  {
    const { seed, local } = setupRemoteScenario('allow-remote-local-disjoint');
    commitAndPush(seed, 'feat: remote file', {
      'remote-only.txt': gitBoundaryFixtures.allow.remoteOnly
    });
    runGit(local, ['fetch', 'origin', 'main']);
    writeText(path.join(local, 'local-only.txt'), gitBoundaryFixtures.allow.localOnly);
    runGit(local, ['add', 'local-only.txt']);
    runGit(local, ['commit', '-m', 'feat: local file']);
    const run = runGitAdmissionScenario('allow-remote-local-disjoint', local);
    assert.equal(run.status, 0);
    assert.equal(String(run.payload.evidence?.outcome), 'allow');
    runs.push(toCapturedRun('allow-remote-local-disjoint', 'git admit', run.payload, [
      'Disjoint local/remote file changes should be admitted.'
    ]));
  }

  {
    const { seed, local } = setupRemoteScenario('block-same-record-conflict');
    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.blockBase);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: add data']);
    runGit(seed, ['push', 'origin', 'main']);
    runGit(local, ['pull', '--ff-only', 'origin', 'main']);
    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.blockRemote);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: remote alpha']);
    runGit(seed, ['push', 'origin', 'main']);
    runGit(local, ['fetch', 'origin', 'main']);
    writeText(path.join(local, 'data.json'), gitBoundaryFixtures.json.blockLocal);
    runGit(local, ['add', 'data.json']);
    runGit(local, ['commit', '-m', 'feat: local alpha']);
    const run = runGitAdmissionScenario('block-same-record-conflict', local);
    assert.notEqual(run.status, 0);
    assert.equal(String(run.payload.evidence?.outcome), 'block');
    runs.push(toCapturedRun('block-same-record-conflict', 'git admit', run.payload, [
      'Shared record conflict should block direct push.'
    ]));
  }

  {
    const { seed, local } = setupRemoteScenario('composer-disjoint-records');
    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.composerBase);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: add data']);
    runGit(seed, ['push', 'origin', 'main']);
    runGit(local, ['pull', '--ff-only', 'origin', 'main']);
    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.composerRemote);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: remote alpha']);
    runGit(seed, ['push', 'origin', 'main']);
    runGit(local, ['fetch', 'origin', 'main']);
    writeText(path.join(local, 'data.json'), gitBoundaryFixtures.json.composerLocal);
    runGit(local, ['add', 'data.json']);
    runGit(local, ['commit', '-m', 'feat: local beta']);
    const run = runGitAdmissionScenario('composer-disjoint-records', local);
    assert.notEqual(run.status, 0);
    assert.equal(String(run.payload.evidence?.outcome), 'composer-routed');
    runs.push(toCapturedRun('composer-disjoint-records', 'git admit', run.payload, [
      'Same file with disjoint mergeable records should route to composer.'
    ]));
  }

  {
    const { seed, local } = setupRemoteScenario('recover-block-non-fast-forward');
    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.blockBase);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: add data']);
    runGit(seed, ['push', 'origin', 'main']);
    runGit(local, ['pull', '--ff-only', 'origin', 'main']);
    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.blockRemote);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: remote alpha']);
    runGit(seed, ['push', 'origin', 'main']);
    writeText(path.join(local, 'data.json'), gitBoundaryFixtures.json.blockLocal);
    runGit(local, ['add', 'data.json']);
    runGit(local, ['commit', '-m', 'feat: local alpha']);
    try {
      runGit(local, ['push', 'origin', 'main']);
      assert.fail('push must be rejected when remote advanced first');
    } catch {}
    const run = runGitRecoveryScenario('recover-block-non-fast-forward', local);
    assert.notEqual(run.status, 0);
    assert.equal(String(run.payload.evidence?.outcome), 'block');
    assert.equal(String((run.payload.evidence?.recovery as Record<string, unknown>)?.mode), 'post-push-fail');
    runs.push(toCapturedRun('recover-block-non-fast-forward', 'git recover-push-fail', run.payload, [
      'Rejected push should rerun admission and recommend rebase for true conflict.'
    ]));
  }

  {
    const { seed, local } = setupRemoteScenario('recover-composer-non-fast-forward');
    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.composerBase);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: add data']);
    runGit(seed, ['push', 'origin', 'main']);
    runGit(local, ['pull', '--ff-only', 'origin', 'main']);
    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.composerRemote);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: remote alpha']);
    runGit(seed, ['push', 'origin', 'main']);
    writeText(path.join(local, 'data.json'), gitBoundaryFixtures.json.composerLocal);
    runGit(local, ['add', 'data.json']);
    runGit(local, ['commit', '-m', 'feat: local beta']);
    try {
      runGit(local, ['push', 'origin', 'main']);
      assert.fail('push must be rejected when remote advanced first');
    } catch {}
    const run = runGitRecoveryScenario('recover-composer-non-fast-forward', local);
    assert.equal(run.status, 0);
    assert.equal(String(run.payload.evidence?.outcome), 'composer-routed');
    assert.equal(String((run.payload.evidence?.recovery as Record<string, unknown>)?.mode), 'post-push-fail');
    runs.push(toCapturedRun('recover-composer-non-fast-forward', 'git recover-push-fail', run.payload, [
      'Rejected push on mergeable same-file change should recommend steward/composer follow-up.'
    ]));
  }

  const summaryPath = path.join(runDir, 'git-boundary-paper-evidence.json');
  const summary = {
    schemaId: 'atm.gitBoundaryPaperEvidence.v1',
    generatedAt: new Date().toISOString(),
    deterministicFixtureSource: 'tests/cli/git-admission-cli.test.ts',
    liveCliRuns: runs
  };
  writeText(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  const markdownPath = path.join(runDir, 'git-boundary-paper-evidence.md');
  writeText(markdownPath, buildMarkdownReport(runs));

  const outcomeSet = new Set(runs.map((entry) => entry.outcome));
  assert.equal(outcomeSet.has('allow'), true);
  assert.equal(outcomeSet.has('block'), true);
  assert.equal(outcomeSet.has('composer-routed'), true);
  assert.equal(runs.some((entry) => entry.command === 'git recover-push-fail'), true);

  console.log('[validate-git-boundary-paper-evidence] ok');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
