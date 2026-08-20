import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHookFailureDiagnosticReport } from '../../packages/cli/src/commands/git-governance/implementation/hook-failure-diagnostics.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-hook-diagnostic-'));
const envelope = {
  schemaId: 'atm.validatorFailureEnvelope.v1',
  ok: false,
  surface: 'pre-commit',
  requiredCommand: 'node atm.mjs tasks renew --task ATM-GOV-0401 --actor codex-captain --json',
  blockingFindings: [{
    code: 'ATM_TASK_DIRECTION_SCOPE_DRIFT',
    source: 'direction-lock',
    detail: 'The admitted write set differs from the active direction lock.',
    requiredCommand: 'node atm.mjs tasks renew --task ATM-GOV-0401 --actor codex-captain --json'
  }],
  baselineFailures: [],
  currentTaskFailures: [{
    code: 'ATM_TASK_DIRECTION_SCOPE_DRIFT',
    source: 'direction-lock',
    detail: 'The admitted write set differs from the active direction lock.',
    requiredCommand: 'node atm.mjs tasks renew --task ATM-GOV-0401 --actor codex-captain --json'
  }],
  governanceStateFailures: [],
  contentValidationFailures: [],
  deferredGovernanceCandidate: false,
  repairHints: [],
  diagnostics: { gitIndexDiagnostic: { ok: true }, failedValidators: [] }
} as const;

try {
  const result = createHookFailureDiagnosticReport({
    cwd: root,
    commitAttemptStatusPath: '.atm/runtime/git-commit-attempts/codex__ATM-GOV-0401.json',
    stdout: JSON.stringify({ evidence: { failureEnvelope: envelope } }),
    stderr: ''
  });

  assert.ok(result, 'a structured hook failure must create an addressable report');
  assert.match(result.summary, /^ATM_TASK_DIRECTION_SCOPE_DRIFT:/);
  assert.match(result.summary, /Next: node atm\.mjs tasks renew/);
  assert.match(result.reference.reportPath, /^\.atm\/runtime\/git-commit-attempts\//);
  assert.match(result.reference.reportSha256, /^sha256:[a-f0-9]{64}$/);
  const persisted = JSON.parse(readFileSync(path.join(root, result.reference.reportPath), 'utf8'));
  assert.deepEqual(persisted.failureEnvelope, envelope);
  assert.equal(persisted.summary, result.summary);

  const destructive = createHookFailureDiagnosticReport({
    cwd: root,
    commitAttemptStatusPath: '.atm/runtime/git-commit-attempts/destructive.json',
    stdout: JSON.stringify({ evidence: { failureEnvelope: {
      ...envelope,
      requiredCommand: 'git reset --hard',
      blockingFindings: [{ ...envelope.blockingFindings[0], requiredCommand: 'git reset --hard' }]
    } } }),
    stderr: ''
  });
  assert.ok(destructive);
  assert.equal(/git reset --hard/i.test(destructive.summary), false);
  assert.match(destructive.summary, /do not run raw destructive Git remediation/);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('[governed-hook-failure-diagnostics] ok');
