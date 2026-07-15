import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function assertBrokerRunScanIndex(): void {
  const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-broker-run-scan-index');
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });

  const runDir = path.join(cwd, 'broker-runs');
  const logPath = path.join(cwd, 'broker-run-log.md');
  const indexPath = path.join(cwd, 'broker-run-index.json');
  const reportPath = path.join(cwd, 'broker-run-report.md');
  mkdirSync(runDir, { recursive: true });

  const fixtureEnvelope = {
    schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'broker run scan fixture' },
    runId: 'run-scan-1',
    planId: 'plan-scan-1',
    records: [
      {
        schemaId: 'atm.brokerOperationRunRecord.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'broker run scan fixture' },
        runId: 'run-scan-1',
        planId: 'plan-scan-1',
        request_identity: ['bench:B-12:TASK-TEAM-0042:close-orch'],
        actor_ids: ['codex', 'cursor'],
        request_files: ['packages/cli/src/commands/team.ts'],
        applied_files: ['packages/cli/src/commands/team.ts'],
        adapter_choice: 'text-range',
        lane_decision: 'queued',
        merge_verdict: 'conflict',
        evidence_path: '.atm/history/evidence/broker-runs/run-scan-1.json',
        task_ids: ['TASK-TEAM-0042', 'TASK-TEAM-0043'],
        commit_sha: 'deadbeef1234',
        transaction_ids: ['txn-a', 'txn-b']
      }
    ]
  };
  writeFileSync(path.join(runDir, 'run-scan-1.json'), `${JSON.stringify(fixtureEnvelope, null, 2)}\n`, 'utf8');

  const result = spawnSync(
    process.execPath,
    [
      '--strip-types',
      path.join(process.cwd(), 'scripts', 'scan-broker-runs.ts'),
      '--run-dir',
      runDir,
      '--log-file',
      logPath,
      '--report-output',
      reportPath,
      '--json-output',
      indexPath,
      '--compact'
    ],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const logText = readFileSync(logPath, 'utf8');
  assert.ok(logText.includes('| runId | planId | requestCount | actorCount | scenarioTags | requestIdentities | actors | taskHints | files | tasks | commits | transactions | adapter | lane | verdict | evidence |'));
  assert.ok(logText.includes('bench:B-12:TASK-TEAM-0042:close-orch'));
  assert.ok(logText.includes('codex,cursor'));
  assert.ok(logText.includes('TASK-TEAM-0042,TASK-TEAM-0043'));
  assert.ok(logText.includes('deadbeef1234'));
  assert.ok(logText.includes('txn-a,txn-b'));

  const reportText = readFileSync(reportPath, 'utf8');
  assert.ok(reportText.includes('| runId | scenario | task | actor | shared files | lane | verdict |'));
  assert.ok(reportText.includes('| run-scan-1 | B-12 | TASK-TEAM-0042 | codex,cursor | packages/cli/src/commands/team.ts | queued | conflict |'));

  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
    schemaId?: string;
    runs?: Array<Record<string, unknown>>;
  };
  assert.equal(index.schemaId, 'atm.brokerRunScanIndex.v1');
  assert.equal(index.runs?.length, 1);
  assert.equal(index.runs?.[0]?.requestIdentities, 'bench:B-12:TASK-TEAM-0042:close-orch');
  assert.equal(index.runs?.[0]?.actors, 'codex,cursor');
  assert.equal(index.runs?.[0]?.lane, 'queued');
  assert.equal(index.runs?.[0]?.verdict, 'conflict');

  const repoLocalCwd = path.join(cwd, 'repo-local-default');
  const repoLocalRunDir = path.join(repoLocalCwd, '.atm', 'history', 'evidence', 'broker-runs');
  const repoLocalLogPath = path.join(repoLocalCwd, '.atm', 'history', 'evidence', 'CID-Conflict-Run-Log.md');
  const repoLocalCaptureDir = path.join(repoLocalRunDir, 'broker-capture');
  const repoLocalCollectDir = path.join(repoLocalRunDir, 'broker-evidence-bundle');
  mkdirSync(repoLocalRunDir, { recursive: true });

  const repoLocalEnvelope = {
    schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'repo-local default resolution fixture' },
    runId: 'run-local-default-1',
    planId: 'plan-local-default-1',
    records: [
      {
        schemaId: 'atm.brokerOperationRunRecord.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'repo-local default resolution fixture' },
        runId: 'run-local-default-1',
        planId: 'plan-local-default-1',
        request_identity: ['bench:B-12:TASK-TEAM-LOCAL-DEFAULT:scan'],
        actor_ids: ['codex-local'],
        request_files: ['packages/cli/src/commands/team.ts'],
        applied_files: ['packages/cli/src/commands/team.ts'],
        adapter_choice: 'text-range',
        lane_decision: 'applied',
        merge_verdict: 'mergeable',
        evidence_path: '.atm/history/evidence/broker-runs/run-local-default-1.json',
        task_ids: ['TASK-TEAM-LOCAL-DEFAULT'],
        commit_sha: 'feedface5678',
        transaction_ids: ['txn-local-default-1']
      }
    ]
  };
  writeFileSync(path.join(repoLocalRunDir, 'run-local-default-1.json'), `${JSON.stringify(repoLocalEnvelope, null, 2)}\n`, 'utf8');

  const repoLocalScan = spawnSync(
    process.execPath,
    [
      '--strip-types',
      path.join(process.cwd(), 'scripts', 'scan-broker-runs.ts'),
      '--compact'
    ],
    { cwd: repoLocalCwd, encoding: 'utf8' }
  );
  assert.equal(repoLocalScan.status, 0, repoLocalScan.stderr || repoLocalScan.stdout);
  assert.equal(existsSync(repoLocalLogPath), true, 'scan-broker-runs without --run-dir must write to repo-local evidence log');
  const repoLocalLogText = readFileSync(repoLocalLogPath, 'utf8');
  assert.ok(repoLocalLogText.includes('run-local-default-1'));
  assert.ok(repoLocalLogText.includes('txn-local-default-1'));

  const repoLocalCollect = spawnSync(
    process.execPath,
    [
      '--strip-types',
      path.join(process.cwd(), 'scripts', 'collect-broker-evidence.ts'),
      '--output-dir',
      repoLocalCollectDir
    ],
    { cwd: repoLocalCwd, encoding: 'utf8' }
  );
  assert.equal(repoLocalCollect.status, 0, repoLocalCollect.stderr || repoLocalCollect.stdout);
  const repoLocalBundle = JSON.parse(readFileSync(path.join(repoLocalCollectDir, 'broker-evidence-bundle.json'), 'utf8')) as {
    sourceRunDir?: string;
    runs?: Array<Record<string, unknown>>;
  };
  assert.equal(repoLocalBundle.sourceRunDir, repoLocalRunDir.replace(/\\/g, '/'));
  assert.ok(repoLocalBundle.runs?.some((run) => run.runId === 'run-local-default-1'));

  const repoLocalCapture = spawnSync(
    process.execPath,
    [
      '--strip-types',
      path.join(process.cwd(), 'scripts', 'capture-broker-evidence.ts'),
      '--run-ids',
      'run-local-default-1',
      '--output-dir',
      repoLocalCaptureDir,
      '--strict',
      'false'
    ],
    { cwd: repoLocalCwd, encoding: 'utf8' }
  );
  assert.equal(repoLocalCapture.status, 0, repoLocalCapture.stderr || repoLocalCapture.stdout);
  const repoLocalCaptured = JSON.parse(readFileSync(path.join(repoLocalCaptureDir, 'broker-capture.json'), 'utf8')) as {
    sourceRunDirs?: string[];
    runs?: Array<Record<string, unknown>>;
  };
  assert.equal(repoLocalCaptured.sourceRunDirs?.[0], repoLocalRunDir.replace(/\\/g, '/'));
  assert.ok(repoLocalCaptured.runs?.some((run) => run.runId === 'run-local-default-1'));

  const realRunDir = path.resolve(
    process.env.USERPROFILE ?? process.env.HOME ?? process.cwd(),
    '3KLife',
    'docs',
    'ai_atomic_framework',
    'broker-collision-evidence',
    'runs'
  );
  if (existsSync(realRunDir)) {
    const realIndexPath = path.join(cwd, 'broker-run-index-real.json');
    const realReportPath = path.join(cwd, 'broker-run-report-real.md');
    const realResult = spawnSync(
      process.execPath,
      [
        '--strip-types',
        path.join(process.cwd(), 'scripts', 'scan-broker-runs.ts'),
        '--run-dir',
        realRunDir,
        '--log-file',
        logPath,
        '--report-output',
        realReportPath,
        '--json-output',
        realIndexPath,
        '--compact'
      ],
      { encoding: 'utf8' }
    );
    assert.equal(realResult.status, 0, realResult.stderr || realResult.stdout);
    const realIndex = JSON.parse(readFileSync(realIndexPath, 'utf8')) as {
      runs?: Array<Record<string, unknown>>;
    };
    assert.ok(realIndex.runs?.some((run) => run.runId === '67b193f9-1244-4e41-9f64-1ebbdbeaa9e5'));
    assert.ok(realIndex.runs?.some((run) => run.runId === 'c393df1d-f9ab-4331-ac3e-3182df57ac45'));
    assert.ok(realIndex.runs?.some((run) => String(run.requestIdentities ?? '').includes('REQ-0041-EVIDENCE-GATES')));
    assert.ok(realIndex.runs?.some((run) => String(run.actors ?? '').includes('cursor-composer-2.5')));
    assert.ok(existsSync(realReportPath));
  }

  rmSync(cwd, { recursive: true, force: true });
}

export function runBrokerRunScanIndexValidatorCase(taskCase: string): boolean {
  if (taskCase !== 'broker-run-scan-index') return false;
  assertBrokerRunScanIndex();
  console.log('[validate-team-agents] ok (broker-run-scan-index)');
  return true;
}
