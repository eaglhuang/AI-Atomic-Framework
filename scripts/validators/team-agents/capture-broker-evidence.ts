import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export async function runCaptureBrokerEvidenceValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'capture-broker-evidence') return false;

    const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-capture-broker-evidence');
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(cwd, { recursive: true });

    const runDir = path.join(cwd, '.atm', 'history', 'evidence', 'broker-runs');
    const teamRunDir = path.join(cwd, '.atm', 'runtime', 'team-runs');
    const outputDir = path.join(cwd, 'capture-output');
    const commandOutput = path.join(cwd, 'command-output');

    mkdirSync(runDir, { recursive: true });
    mkdirSync(teamRunDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });

    const baselineRun = path.join(runDir, 'baseline.json');
    const baselineRunPayload = {
      schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
      specVersion: '0.1.0',
      runId: 'run-baseline-1',
      planId: 'plan-baseline-1',
      records: [
        {
          request_identity: ['bench:B-12:TASK-TEAM-0042:close-orch'],
          actor_ids: ['codex'],
          request_files: ['packages/cli/src/commands/team.ts'],
          adapter_choice: 'text-range',
          lane_decision: 'applied',
          merge_verdict: 'applied',
          evidence_path: 'evidence/baseline.json',
          task_ids: ['TASK-TEAM-0042'],
          commit_sha: 'baselinecommit',
          transaction_ids: ['txn-baseline-1']
        }
      ]
    };
    writeFileSync(baselineRun, `${JSON.stringify(baselineRunPayload, null, 2)}\n`, 'utf8');

    const collectResult = spawnSync(
      process.execPath,
      [
        '--strip-types',
        path.join(process.cwd(), 'scripts', 'capture-broker-evidence.ts'),
        '--run-dir',
        runDir,
        '--run-ids',
        'run-baseline-1',
        '--output-dir',
        outputDir,
        '--json-output',
        path.join(outputDir, 'filter-broker-capture.json'),
        '--report-output',
        path.join(outputDir, 'filter-broker-capture.md')
      ],
      { encoding: 'utf8' }
    );
    assert.equal(collectResult.status, 0, collectResult.stderr || collectResult.stdout);
    const filtered = JSON.parse(readFileSync(path.join(outputDir, 'filter-broker-capture.json'), 'utf8')) as {
      runs?: Array<{
        runId: string;
        requiredFields?: string[];
      }>;
    };
    assert.equal(filtered.runs?.length, 1, 'filtered run capture should keep baseline run');
    assert.equal(filtered.runs?.[0]?.runId, 'run-baseline-1');
    assert.ok(
      Array.isArray(filtered.runs?.[0]?.requiredFields),
      'requiredFields should be collected for schema audit'
    );

    const teamRunPath = path.join(teamRunDir, 'team-capture-1.json');
    writeFileSync(teamRunPath, `${JSON.stringify({
      schemaId: 'atm.teamRun.v1',
      specVersion: '0.1.0',
      teamRunId: 'team-capture-1',
      taskId: 'TASK-TEAM-0042',
      actorId: 'codex',
      planId: 'bench:B-12:TASK-TEAM-0042:team-run',
      brokerLane: {
        chosenLane: 'queued',
        decision: {
          lane: 'queued',
          verdict: 'blocked'
        },
        writeIntent: {
          requestIdentity: 'bench:B-12:TASK-TEAM-0042:team-run',
          actorId: 'codex',
          requestFiles: ['packages/cli/src/commands/team.ts'],
          baseCommit: 'teamrunbase'
        },
        writeTransaction: {
          transactionId: 'txn-team-run-1',
          writeSet: ['packages/cli/src/commands/team.ts']
        }
      }
    }, null, 2)}\n`, 'utf8');

    const teamCaptureResult = spawnSync(
      process.execPath,
      [
        '--strip-types',
        path.join(process.cwd(), 'scripts', 'capture-broker-evidence.ts'),
        '--run-dir',
        runDir,
        '--team-run-dir',
        teamRunDir,
        '--task-ids',
        'TASK-TEAM-0042',
        '--output-dir',
        path.join(cwd, 'capture-output-team-run'),
        '--json-output',
        path.join(cwd, 'capture-output-team-run', 'team-broker-capture.json'),
        '--report-output',
        path.join(cwd, 'capture-output-team-run', 'team-broker-capture.md')
      ],
      { encoding: 'utf8' }
    );
    assert.equal(teamCaptureResult.status, 0, teamCaptureResult.stderr || teamCaptureResult.stdout);
    const teamCaptured = JSON.parse(readFileSync(path.join(cwd, 'capture-output-team-run', 'team-broker-capture.json'), 'utf8')) as {
      runs?: Array<{ runId: string; scenario: string; lane: string; verdict: string; transactions: string; files: string }>;
      sourceTeamRunDirs?: string[];
    };
    const teamCapturedRow = teamCaptured.runs?.find((row) => row.runId === 'team-capture-1');
    assert.ok(teamCapturedRow, 'team-run brokerLane should be captured as a run row');
    assert.equal(teamCapturedRow?.scenario, 'B-12');
    assert.equal(teamCapturedRow?.lane, 'queued');
    assert.equal(teamCapturedRow?.verdict, 'blocked');
    assert.ok(teamCapturedRow?.transactions.includes('txn-team-run-1'));
    assert.ok(teamCapturedRow?.files.includes('packages/cli/src/commands/team.ts'));
    assert.ok(teamCaptured.sourceTeamRunDirs?.[0]?.includes('team-runs'));

    const teamCollectResult = spawnSync(
      process.execPath,
      [
        '--strip-types',
        path.join(process.cwd(), 'scripts', 'collect-broker-evidence.ts'),
        '--run-dir',
        runDir,
        '--team-run-dir',
        teamRunDir,
        '--task-ids',
        'TASK-TEAM-0042',
        '--output-dir',
        path.join(cwd, 'collect-output-team-run')
      ],
      { encoding: 'utf8' }
    );
    assert.equal(teamCollectResult.status, 0, teamCollectResult.stderr || teamCollectResult.stdout);
    const teamCollected = JSON.parse(readFileSync(path.join(cwd, 'collect-output-team-run', 'broker-evidence-bundle.json'), 'utf8')) as {
      runs?: Array<{ runId: string; scenario: string; lane: string; verdict: string }>;
      sourceTeamRunDir?: string;
    };
    const teamCollectedRow = teamCollected.runs?.find((row) => row.runId === 'team-capture-1');
    assert.ok(teamCollectedRow, 'collect-broker-evidence should include team-run brokerLane row');
    assert.equal(teamCollectedRow?.scenario, 'B-12');
    assert.equal(teamCollectedRow?.lane, 'queued');
    assert.equal(teamCollectedRow?.verdict, 'blocked');
    assert.ok(teamCollected.sourceTeamRunDir?.includes('team-runs'));

    const writerPath = path.join(commandOutput, 'write-run.cjs');
    mkdirSync(commandOutput, { recursive: true });
    const awaitedRun = path.join(runDir, 'run-await-1.json');
    const awaitedRunPayload = {
      schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
      specVersion: '0.1.0',
      runId: 'run-await-1',
      planId: 'plan-await-1',
      records: [
        {
          request_identity: ['bench:B-12:TASK-TEAM-0043:close-orch'],
          actor_ids: ['cursor'],
          request_files: ['packages/cli/src/commands/team.ts'],
          adapter_choice: 'text-range',
          lane_decision: 'queued',
          merge_verdict: 'conflict',
          evidence_path: 'evidence/await.json',
          task_ids: ['TASK-TEAM-0043'],
          commit_sha: 'awaitcommit',
          transaction_ids: ['txn-await-1']
        }
      ]
    };
    const writerSource = `const fs = require('fs');\nconst path = process.argv[2];\nconst payload = ${JSON.stringify(awaitedRunPayload, null, 2)};\nconst delay = Number(process.argv[3] ?? 0);\nsetTimeout(() => { fs.writeFileSync(path, JSON.stringify(payload, null, 2) + '\\n', 'utf8'); }, delay);\n`;
    writeFileSync(writerPath, writerSource, 'utf8');

    const awaitResult = spawnSync(
      process.execPath,
      [
        '--strip-types',
        path.join(process.cwd(), 'scripts', 'capture-broker-evidence.ts'),
        '--run-dir',
        runDir,
        '--command',
        `node "${writerPath.replace(/\\\\/g, '/')}" "${awaitedRun.replace(/\\\\/g, '/')}" 200`,
        '--await-new',
        '1',
        '--timeout-ms',
        '5000',
        '--poll-ms',
        '250',
        '--output-dir',
        path.join(cwd, 'capture-output-await'),
        '--json-output',
        path.join(cwd, 'capture-output-await', 'run-capture.json'),
        '--report-output',
        path.join(cwd, 'capture-output-await', 'run-capture.md')
      ],
      { encoding: 'utf8' }
    );
    assert.equal(awaitResult.status, 0, awaitResult.stderr || awaitResult.stdout);

    const awaited = JSON.parse(readFileSync(path.join(cwd, 'capture-output-await', 'run-capture.json'), 'utf8')) as {
      runs?: Array<{ runId: string; lane: string; verdict: string }>;
      commandLog?: Array<{ command: string; exitCode: number }>;
    };
    assert.equal(awaited.runs?.length, 1, 'await new should capture newly generated broker run');
    assert.equal(awaited.runs?.[0]?.runId, 'run-await-1');
    assert.equal(awaited.runs?.[0]?.lane, 'queued');
    assert.equal(awaited.runs?.[0]?.verdict, 'conflict');
    assert.equal(awaited.commandLog?.length, 1);
    assert.equal(awaited.commandLog?.[0]?.exitCode, 0);

    const parallelStamp = `run-parallel-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
    const runParallelA = path.join(runDir, `${parallelStamp}-a.json`);
    const runParallelB = path.join(runDir, `${parallelStamp}-b.json`);
    const parallelPayloadA = {
      schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
      specVersion: '0.1.0',
      runId: `${parallelStamp}-a`,
      planId: `${parallelStamp}-plan-a`,
      records: [
        {
          request_identity: ['bench:B-12:TASK-TEAM-0042:close-orch'],
          actor_ids: ['codex'],
          request_files: ['packages/cli/src/commands/team.ts'],
          adapter_choice: 'text-range',
          lane_decision: 'queued',
          merge_verdict: 'conflict',
          evidence_path: 'evidence/parallel-a.json',
          task_ids: ['TASK-TEAM-0042'],
          commit_sha: 'parallel-a',
          transaction_ids: ['txn-parallel-a']
        }
      ]
    };
    const parallelPayloadB = {
      schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
      specVersion: '0.1.0',
      runId: `${parallelStamp}-b`,
      planId: `${parallelStamp}-plan-b`,
      records: [
        {
          request_identity: ['bench:B-12:TASK-TEAM-0043:close-orch'],
          actor_ids: ['cursor'],
          request_files: ['packages/cli/src/commands/team.ts'],
          adapter_choice: 'text-range',
          lane_decision: 'queued',
          merge_verdict: 'conflict',
          evidence_path: 'evidence/parallel-b.json',
          task_ids: ['TASK-TEAM-0043'],
          commit_sha: 'parallel-b',
          transaction_ids: ['txn-parallel-b']
        }
      ]
    };
    const writerParallelSource = `const fs = require('fs');\nconst path = process.argv[2];\nconst payloadPath = process.argv[3];\nconst delay = Number(process.argv[4] ?? 0);\nconst payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));\nsetTimeout(() => { fs.writeFileSync(path, JSON.stringify(payload, null, 2) + '\\n', 'utf8'); }, delay);\n`;
    const writerParallelPathA = path.join(commandOutput, 'write-parallel-a.cjs');
    const writerParallelPathB = path.join(commandOutput, 'write-parallel-b.cjs');
    writeFileSync(writerParallelPathA, writerParallelSource, 'utf8');
    writeFileSync(writerParallelPathB, writerParallelSource, 'utf8');
    const payloadPathA = path.join(commandOutput, 'payload-parallel-a.json');
    const payloadPathB = path.join(commandOutput, 'payload-parallel-b.json');
    writeFileSync(payloadPathA, `${JSON.stringify(parallelPayloadA)}\n`, 'utf8');
    writeFileSync(payloadPathB, `${JSON.stringify(parallelPayloadB)}\n`, 'utf8');
    rmSync(runParallelA, { force: true });
    rmSync(runParallelB, { force: true });

    const awaitParallelResult = spawnSync(
      process.execPath,
      [
        '--strip-types',
        path.join(process.cwd(), 'scripts', 'capture-broker-evidence.ts'),
        '--run-dir',
        runDir,
        '--command',
        `node "${writerParallelPathA.replace(/\\\\/g, '/')}" "${runParallelA.replace(/\\\\/g, '/')}" "${payloadPathA.replace(/\\\\/g, '/')}" 500`,
        '--command',
        `node "${writerParallelPathB.replace(/\\\\/g, '/')}" "${runParallelB.replace(/\\\\/g, '/')}" "${payloadPathB.replace(/\\\\/g, '/')}" 500`,
        '--await-new',
        '2',
        '--timeout-ms',
        '5000',
        '--poll-ms',
        '250',
        '--output-dir',
        path.join(cwd, 'capture-output-parallel'),
        '--json-output',
        path.join(cwd, 'capture-output-parallel', 'run-parallel-capture.json'),
        '--report-output',
        path.join(cwd, 'capture-output-parallel', 'run-parallel-capture.md')
      ],
      { encoding: 'utf8' }
    );
    assert.equal(awaitParallelResult.status, 0, awaitParallelResult.stderr || awaitParallelResult.stdout);

    const awaitedParallel = JSON.parse(readFileSync(path.join(cwd, 'capture-output-parallel', 'run-parallel-capture.json'), 'utf8')) as {
      runs?: Array<{ runId: string; lane: string; verdict: string }>;
      commandLog?: Array<{ command: string; exitCode: number; signal?: string | null; durationMs?: number }>;
    };
    assert.equal(awaitedParallel.runs?.length, 2, 'await new should capture two parallel generated broker runs');
    assert.equal(awaitedParallel.commandLog?.length, 2, 'parallel commands should be tracked');
    assert.equal(awaitedParallel.commandLog?.[0]?.exitCode, 0);
    assert.equal(awaitedParallel.commandLog?.[1]?.exitCode, 0);
    assert.ok(awaitedParallel.commandLog?.[0]?.durationMs && awaitedParallel.commandLog?.[1]?.durationMs);

    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (capture-broker-evidence)');
    return true;

}
