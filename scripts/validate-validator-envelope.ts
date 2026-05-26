import { spawnSync } from 'node:child_process';
import { createValidator } from './lib/validator-harness.ts';
import { createValidatorFailureEnvelope } from './lib/validator-envelope.ts';

const validator = createValidator('validate-validator-envelope');

const sandboxEnvelope = createValidatorFailureEnvelope({
  validatorName: 'synthetic-sandbox',
  command: 'node --strip-types scripts/validate-cli.ts --mode validate',
  entry: 'scripts/validate-cli.ts',
  mode: 'validate',
  ok: false,
  exitCode: 1,
  stderr: 'Error: spawnSync git EPERM'
});

validator.assert(
  sandboxEnvelope.blockingFindings.some((finding) => finding.code === 'ATM_ENV_SANDBOX_GIT_EPERM'),
  'sandbox git EPERM must be classified separately from generic validator failure'
);
validator.assert(
  sandboxEnvelope.requiredCommand === 'node --strip-types scripts/validate-cli.ts --mode validate',
  'sandbox envelope must keep the rerunnable requiredCommand'
);

const indexLockEnvelope = createValidatorFailureEnvelope({
  validatorName: 'synthetic-index-lock',
  command: 'node --strip-types scripts/validate-git-head-evidence.ts --mode validate',
  entry: 'scripts/validate-git-head-evidence.ts',
  mode: 'validate',
  ok: false,
  exitCode: 1,
  stderr: 'fatal: Unable to create C:/repo/.git/index.lock: File exists.'
});

validator.assert(
  indexLockEnvelope.blockingFindings.some((finding) => finding.code === 'ATM_GIT_INDEX_LOCK_PRESENT'),
  'index.lock failures must be distinguishable from sandbox EPERM'
);

const atmGateEnvelope = createValidatorFailureEnvelope({
  validatorName: 'synthetic-atm-gate',
  command: 'node atm.mjs hook pre-commit --json',
  entry: 'packages/cli/src/commands/hook.ts',
  mode: 'validate',
  ok: false,
  exitCode: 1,
  stdout: JSON.stringify({
    ok: false,
    messages: [
      {
        level: 'error',
        code: 'ATM_HOOK_PRE_COMMIT_FAILED',
        text: 'ATM pre-commit hook blocked this commit.',
        data: {
          blockingFindings: [
            {
              code: 'ATM_TASK_DIRECTION_SCOPE_DRIFT',
              source: 'direction-lock',
              detail: 'Staged files are outside the active task direction lock allowedFiles.',
              requiredCommand: 'node atm.mjs tasks scope --add <path> --json'
            }
          ]
        }
      }
    ]
  })
});

validator.assert(
  atmGateEnvelope.blockingFindings.some((finding) => finding.code === 'ATM_TASK_DIRECTION_SCOPE_DRIFT'),
  'ATM gate JSON blockingFindings must be preserved in the validator envelope'
);
validator.assert(
  atmGateEnvelope.requiredCommand === 'node atm.mjs tasks scope --add <path> --json',
  'ATM gate requiredCommand must be promoted to the envelope root'
);

const passingEnvelope = createValidatorFailureEnvelope({
  validatorName: 'synthetic-pass',
  command: 'node --strip-types scripts/validate-product-charter.ts --mode validate',
  entry: 'scripts/validate-product-charter.ts',
  mode: 'validate',
  ok: true,
  exitCode: 0,
  stdout: '[validate-product-charter:validate] ok\n'
});

validator.assert(passingEnvelope.blockingFindings.length === 0, 'passing validators must not emit blockingFindings');
validator.assert(passingEnvelope.requiredCommand === null, 'passing validators must not emit requiredCommand');

const runner = spawnSync(process.execPath, [
  '--strip-types',
  validator.repoPath('scripts', 'run-validators.ts'),
  'quick',
  '--filter',
  'validate-product-charter',
  '--json'
], {
  cwd: validator.root,
  encoding: 'utf8'
});

const runnerStdout = typeof runner.stdout === 'string' ? runner.stdout : '';
if (runnerStdout.trim().startsWith('{')) {
  const parsed = JSON.parse(runnerStdout);
  validator.assert(parsed.schemaId === 'atm.validatorRunSummary.v1', 'runner JSON summary must declare its schemaId');
  validator.assert(Array.isArray(parsed.blockingFindings), 'runner JSON summary must include blockingFindings[]');
  validator.assert(
    parsed.validators?.[0]?.envelope?.schemaId === 'atm.validatorFailureEnvelope.v1',
    'each runner validator result must include a validator failure envelope'
  );
  if (runner.status === 0) {
    validator.assert(parsed.requiredCommand === null, 'passing runner summary must not include requiredCommand');
  } else {
    validator.assert(
      parsed.blockingFindings.some((finding: any) => finding.code === 'ATM_ENV_PROCESS_SPAWN_EPERM'),
      'sandboxed runner spawn failure must still be returned as a structured environment envelope'
    );
  }
} else {
  const spawnEnvelope = createValidatorFailureEnvelope({
    validatorName: 'run-validators-smoke',
    command: 'node --strip-types scripts/run-validators.ts quick --filter validate-product-charter --json',
    entry: 'scripts/run-validators.ts',
    mode: 'validate',
    ok: false,
    exitCode: runner.status ?? 1,
    stderr: typeof runner.stderr === 'string' ? runner.stderr : '',
    spawnError: runner.error ? `${runner.error.name}: ${runner.error.message}` : 'spawnSync node EPERM'
  });
  validator.assert(
    spawnEnvelope.blockingFindings.some((finding) => finding.code === 'ATM_ENV_PROCESS_SPAWN_EPERM'),
    'sandboxed test harness spawn failure must still be classifiable as environment envelope'
  );
}

validator.ok('validator envelopes classify sandbox, index-lock, ATM gate, and passing runner cases');
