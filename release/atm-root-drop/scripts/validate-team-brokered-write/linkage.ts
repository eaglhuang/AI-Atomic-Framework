import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildTeamBrokerRunRecord, buildTeamBrokerRunRecordEnvelope } from '../../packages/core/src/broker/index.ts';
import { check, formatAjvErrors, root, runAtm, validateBrokerOperationRunRecord, writeJson } from './context.ts';

export function assertBrokerRunLogKeepsTaskLinkage(cwd: string) {
  const runDir = path.join(cwd, 'broker-runs');
  const logPath = path.join(cwd, 'broker-run-log.md');
  const reportPath = path.join(cwd, 'broker-run-report.md');
  mkdirSync(runDir, { recursive: true });

  const request = {
    schemaId: 'atm.mutationRequest.v1' as const,
    specVersion: '0.1.0' as const,
    migration: { strategy: 'none' as const, fromVersion: null, notes: 'team broker log fixture' },
    requestId: 'bench:B-12:TASK-TEAM-BROKER-LOG:req-team-log-1',
    actorId: 'coordinator-1',
    taskId: 'TASK-TEAM-BROKER-LOG',
    filePath: 'src/shared-target.ts',
    op: 'append',
    target: 'EOF',
    value: 'beta'
  };
  const record = buildTeamBrokerRunRecord({
    runId: 'run-team-log-1',
    planId: 'plan-team-log-1',
    request,
    adapterChoice: 'text-range',
    laneDecision: 'neutral-steward',
    mergeVerdict: 'mergeable',
    evidencePath: '.atm/history/evidence/broker-runs/run-team-log-1.json',
    appliedFiles: ['src/shared-target.ts'],
    commitSha: 'abc123teamlogcommit',
    transactionIds: ['txn-team-log-1']
  });
  check(record.transaction_ids?.[0] === 'txn-team-log-1', 'broker run record must preserve transaction id linkage');
  const envelope = buildTeamBrokerRunRecordEnvelope({
    runId: 'run-team-log-1',
    planId: 'plan-team-log-1',
    records: [record]
  });
  check(
    validateBrokerOperationRunRecord(envelope),
    `broker run record envelope must match schema: ${formatAjvErrors(validateBrokerOperationRunRecord.errors)}`
  );
  writeJson(path.join(runDir, 'run-team-log-1.json'), envelope);

  const result = spawnSync(
    process.execPath,
    ['--strip-types', path.join(root, 'scripts', 'scan-broker-runs.ts'), '--run-dir', runDir, '--log-file', logPath, '--report-output', reportPath, '--compact'],
    { encoding: 'utf8' }
  );
  check(result.status === 0, `scan-broker-runs failed: ${result.stderr || result.stdout}`);
  const logText = readFileSync(logPath, 'utf8');
  check(logText.includes('| runId | planId | requestCount | actorCount | scenarioTags | requestIdentities | actors | taskHints | files | tasks | commits | transactions | adapter | lane | verdict | evidence |'), 'broker run log must expose the expanded broker evidence columns');
  check(logText.includes('| run-team-log-1 | plan-team-log-1 | 1 | 1 | B-12 | bench:B-12:TASK-TEAM-BROKER-LOG:req-team-log-1 | coordinator-1 | TASK-TEAM-BROKER-LOG | src/shared-target.ts | TASK-TEAM-BROKER-LOG | abc123teamlogcommit | txn-team-log-1 | text-range | neutral-steward | mergeable | .atm/history/evidence/broker-runs/run-team-log-1.json |'), 'broker run log must preserve task, commit, and transaction linkage');

  const reportText = readFileSync(reportPath, 'utf8');
  check(reportText.includes('| runId | scenario | task | actor | shared files | lane | verdict |'), 'broker evidence report must expose the report columns');
  check(reportText.includes('| run-team-log-1 | B-12 | TASK-TEAM-BROKER-LOG | coordinator-1 | src/shared-target.ts | neutral-steward | mergeable |'), 'broker evidence report must preserve the shared file and lane summary');
}

export async function assertBrokerPlanBatchKeepsTransactionLinkage(cwd: string) {
  const brokeredTextFile = 'docs/broker-transaction-log.md';
  const brokeredTextPath = path.join(cwd, brokeredTextFile);
  mkdirSync(path.dirname(brokeredTextPath), { recursive: true });
  writeFileSync(brokeredTextPath, 'alpha\n', 'utf8');
  const requestPath = path.join(cwd, 'broker-request-with-transaction.json');
  const runEvidenceDir = path.join(cwd, 'broker-plan-runs');
  writeJson(requestPath, {
    schemaId: 'atm.mutationRequest.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'team broker transaction fixture' },
    requestId: 'req-team-cli-transaction',
    actorId: 'coordinator-1',
    taskId: 'TASK-TEAM-BROKER-CLI-TXN',
    transactionId: 'txn-team-cli-transaction',
    filePath: brokeredTextFile,
    op: 'append',
    target: 'EOF',
    value: 'gamma'
  });

  const result = await runAtm([
    'broker', 'plan-batch',
    '--request-file', requestPath,
    '--apply',
    '--run-evidence-dir', runEvidenceDir
  ], cwd);
  check(result.exitCode === 0 && result.parsed.ok === true, `broker plan-batch apply must pass: ${JSON.stringify(result.parsed)}`);

  const runRecords = (result.parsed.evidence as Record<string, unknown>)?.runRecords as Array<Record<string, unknown>> | undefined;
  check(runRecords?.[0]?.transaction_ids instanceof Array, 'broker plan-batch run record must expose transaction_ids');
  check((runRecords?.[0]?.transaction_ids as string[]).includes('txn-team-cli-transaction'), 'broker plan-batch run record must preserve request transaction id');

  const runEvidencePath = (result.parsed.evidence as Record<string, unknown>)?.runEvidencePath;
  check(typeof runEvidencePath === 'string' && runEvidencePath.length > 0, 'broker plan-batch must report run evidence path');
  const envelope = JSON.parse(readFileSync(path.join(cwd, runEvidencePath as string), 'utf8')) as Record<string, unknown>;
  check(
    validateBrokerOperationRunRecord(envelope),
    `broker plan-batch persisted run envelope must match schema: ${formatAjvErrors(validateBrokerOperationRunRecord.errors)}`
  );
  const persistedRecords = envelope.records as Array<Record<string, unknown>>;
  check(
    (persistedRecords?.[0]?.transaction_ids as string[] | undefined)?.includes('txn-team-cli-transaction') === true,
    'broker plan-batch persisted run envelope must preserve request transaction id'
  );
}

