import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runEvidence } from '../packages/cli/src/commands/evidence.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-evidence-command-runs-'));
  mkdirSync(path.join(repo, '.atm', 'history', 'tasks'), { recursive: true });
  mkdirSync(path.join(repo, '.atm', 'runtime', 'command-runs'), { recursive: true });
  const taskPath = path.join(repo, '.atm', 'history', 'tasks', 'TASK-EVIDENCE-0001.json');
  writeFileSync(taskPath, `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-EVIDENCE-0001',
    title: 'Evidence command run validation task',
    status: 'running',
    kind: 'code',
    scope: ['packages/cli/src/commands/evidence.ts']
  }, null, 2)}\n`, 'utf8');

  const emptySha = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const commandRunsPath = path.join(repo, '.atm', 'runtime', 'command-runs', 'validators.json');
  writeFileSync(commandRunsPath, `${JSON.stringify({
    commandRuns: [
      {
        command: 'node atm.dev.mjs validate sample --json',
        exitCode: 0,
        stdoutSha256: emptySha,
        stderrSha256: emptySha,
        validators: ['sample-validator'],
        cached: true
      },
      {
        command: 'npm run typecheck',
        exitCode: 0,
        stdoutSha256: emptySha,
        stderrSha256: emptySha,
        validators: ['typecheck']
      }
    ]
  }, null, 2)}\n`, 'utf8');

  const added = await runEvidence([
    'add',
    '--cwd',
    repo,
    '--task',
    'TASK-EVIDENCE-0001',
    '--actor',
    'validator',
    '--kind',
    'test',
    '--summary',
    'cached command runs passed',
    '--validators',
    'validate:cli',
    '--command-runs',
    commandRunsPath,
    '--runner-kind',
    'dev-source',
    '--source-commit',
    'abcdef1234567890',
    '--json'
  ]);
  assert((added.evidence as any).commandRunCount === 2, 'evidence add must report both command runs');
  assert((added.evidence as any).commandRunCache?.schemaId === 'atm.commandRunCache.v1', 'evidence add must expose commandRunCache metadata');

  const evidencePath = path.join(repo, '.atm', 'history', 'evidence', 'TASK-EVIDENCE-0001.json');
  const envelope = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const record = envelope.evidence[0];
  const commandRuns = record.details.commandRuns;
  assert(Array.isArray(commandRuns) && commandRuns.length === 2, 'evidence file must persist commandRuns[]');
  assert(commandRuns[0].runnerKind === 'dev-source', 'dev runner command must be marked as dev-source');
  assert(commandRuns[0].sourceCommit === 'abcdef1234567890', 'dev runner evidence must record sourceCommit');
  assert(commandRuns[0].cached === true, 'command run cache reuse marker must be preserved');
  assert(typeof commandRuns[0].cacheKey === 'string' && commandRuns[0].cacheKey.startsWith('sha256:'), 'command run must get a deterministic cacheKey');
  assert(record.details.validationPasses.includes('validate:cli'), 'explicit validator must be preserved');
  assert(record.details.validationPasses.includes('sample-validator'), 'command run validators must be merged into validationPasses');
  assert(record.details.validationPasses.includes('typecheck'), 'all command run validators must be merged');

  const failedRunsPath = path.join(repo, '.atm', 'runtime', 'command-runs', 'failed-validator.json');
  writeFileSync(failedRunsPath, `${JSON.stringify({
    commandRuns: [
      {
        command: 'npm run validate:atm-self-atomization',
        exitCode: 1,
        stdoutSha256: emptySha,
        stderrSha256: emptySha,
        validators: ['validate:atm-self-atomization']
      }
    ]
  }, null, 2)}\n`, 'utf8');
  let rejectedFailedPass = false;
  try {
    await runEvidence([
      'add',
      '--cwd',
      repo,
      '--task',
      'TASK-EVIDENCE-0001',
      '--actor',
      'validator',
      '--kind',
      'test',
      '--summary',
      'failed validator should not become pass evidence',
      '--command-runs',
      failedRunsPath,
      '--json'
    ]);
  } catch (error) {
    rejectedFailedPass = (error as { code?: string }).code === 'ATM_EVIDENCE_VALIDATION_PASS_FAILED_COMMAND';
  }
  assert(rejectedFailedPass, 'evidence add must reject validationPasses backed by non-zero commandRuns');

  const verify = await runEvidence([
    'verify',
    '--cwd',
    repo,
    '--task',
    'TASK-EVIDENCE-0001',
    '--gate',
    'close',
    '--json'
  ]);
  assert(verify.ok === true, 'commandRun evidence must satisfy close evidence gate');

  // TASK-AAO-0017 follow-up regression：已 close 的 task 在只擁有 focused/task-declared
  // validator 證據時，evidence missing 不應因 advisory framework gates（doctor、
  // framework-development、tasks-audit、git-head-evidence）回 ok:false。
  // 1) 將 task 標記為 done 並補上 closure marker
  const closedTaskPath = path.join(repo, '.atm', 'history', 'tasks', 'TASK-EVIDENCE-0001.json');
  const closedTask = JSON.parse(readFileSync(closedTaskPath, 'utf8'));
  closedTask.status = 'done';
  closedTask.closedAt = new Date().toISOString();
  closedTask.validators = ['npm run typecheck', 'npm run validate:cli'];
  writeFileSync(closedTaskPath, `${JSON.stringify(closedTask, null, 2)}\n`, 'utf8');

  // 2) 補一筆 validate:git-head-evidence 的 fresh command-run，模擬 close 前完整覆蓋 focused 三個
  const focusedRunsPath = path.join(repo, '.atm', 'runtime', 'command-runs', 'focused.json');
  writeFileSync(focusedRunsPath, `${JSON.stringify({
    commandRuns: [
      {
        command: 'npm run validate:git-head-evidence',
        exitCode: 0,
        stdoutSha256: emptySha,
        stderrSha256: emptySha,
        validators: ['validate:git-head-evidence']
      }
    ]
  }, null, 2)}\n`, 'utf8');
  await runEvidence([
    'add',
    '--cwd', repo,
    '--task', 'TASK-EVIDENCE-0001',
    '--actor', 'validator',
    '--kind', 'test',
    '--summary', 'closure-required focused validator captured',
    '--command-runs', focusedRunsPath,
    '--json'
  ]);

  // 3) 呼叫 evidence missing
  const missing = await runEvidence([
    'missing',
    '--cwd', repo,
    '--task', 'TASK-EVIDENCE-0001',
    '--actor', 'validator',
    '--json'
  ]);
  const report = (missing.evidence as any) ?? {};
  assert(missing.ok === true, `evidence missing on closed task with focused validators must be ok:true, got ok=${missing.ok}, tldr=${report.tldr}`);
  assert(Array.isArray(report.blockingFindings) && report.blockingFindings.length === 0,
    `closed task evidence missing must have empty blockingFindings, got ${JSON.stringify(report.blockingFindings)}`);
  assert(Array.isArray(report.missingValidationPasses) && report.missingValidationPasses.length === 0,
    'closure-required missingValidationPasses must be empty when focused validators captured');
  assert(Array.isArray(report.advisoryFindings) && report.advisoryFindings.length > 0,
    'advisoryFindings must surface batch-tier framework gates (doctor/framework-development/tasks-audit/git-head-evidence) as non-blocking');
  const advisoryNames = report.advisoryFindings.map((f: any) => f.validator);
  for (const adv of ['doctor', 'framework-development', 'tasks-audit', 'git-head-evidence']) {
    assert(advisoryNames.includes(adv),
      `advisoryFindings must include ${adv} when no evidence captured for it; got ${JSON.stringify(advisoryNames)}`);
  }
  // 4) catalog entries must carry closureRequired flag with correct values
  const catalog = report.validators as any[];
  const typecheckEntry = catalog.find((e) => e.name === 'typecheck');
  assert(typecheckEntry?.closureRequired === true,
    'typecheck must be closureRequired:true');
  const doctorEntry = catalog.find((e) => e.name === 'doctor');
  assert(doctorEntry?.closureRequired === false,
    'doctor must be closureRequired:false (advisory batch-tier gate)');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
