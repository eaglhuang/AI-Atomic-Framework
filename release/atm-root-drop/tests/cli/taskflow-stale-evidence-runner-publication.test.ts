import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeValidatorIdentity,
  looksLikeLiteralValidatorCommand,
  resolveValidatorExpectedCommand
} from '../../packages/cli/src/commands/evidence/validator-classification.ts';
import {
  assessEvidenceFreshness,
  classifyValidatorEvidenceState
} from '../../packages/cli/src/commands/evidence/missing-report.ts';

test('looksLikeLiteralValidatorCommand handles env var prefixes correctly', () => {
  assert.equal(looksLikeLiteralValidatorCommand('npm run build'), true);
  assert.equal(looksLikeLiteralValidatorCommand('ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build'), true);
  assert.equal(looksLikeLiteralValidatorCommand('NODE_ENV=production npm test'), true);
  assert.equal(looksLikeLiteralValidatorCommand('FOO=bar BAR=baz node script.js'), true);
  assert.equal(looksLikeLiteralValidatorCommand('typecheck'), false);
  assert.equal(looksLikeLiteralValidatorCommand('validate:cli'), false);
});

test('canonicalizeValidatorIdentity strips leading environment variables', () => {
  assert.equal(canonicalizeValidatorIdentity('ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build'), 'build');
  assert.equal(canonicalizeValidatorIdentity('NODE_ENV=test npm test'), 'test');
  assert.equal(canonicalizeValidatorIdentity('ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run typecheck'), 'typecheck');
});

test('resolveValidatorExpectedCommand returns verbatim command for env var prefixed commands', () => {
  assert.equal(
    resolveValidatorExpectedCommand('ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build'),
    'ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build'
  );
  assert.notEqual(
    resolveValidatorExpectedCommand('ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build'),
    'node atm.mjs ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build --json'
  );
});

test('classifyValidatorEvidenceState recognizes command run with env prefix matching validator', () => {
  const bundle = [
    {
      evidenceKind: 'validation',
      evidenceFreshness: 'fresh',
      details: {
        kind: 'test',
        freshness: 'fresh',
        validationPasses: ['build'],
        commandRuns: [
          {
            command: 'ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build',
            exitCode: 0,
            stdoutSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            stderrSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            validators: ['build']
          }
        ]
      }
    }
  ];

  const state = classifyValidatorEvidenceState(bundle, 'build');
  assert.equal(state, 'pass');
});

test('assessEvidenceFreshness accepts matching published runner receipt without marking build stale', () => {
  const result = assessEvidenceFreshness({
    taskId: 'TASK-LANE-0001',
    actorId: 'gemini-captain',
    runnerKind: 'frozen-runner',
    validators: [
      {
        name: 'build',
        tier: 'focused',
        closureRequired: true,
        expectedCommand: 'ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build',
        evidenceState: 'pass'
      }
    ],
    validatorReceipts: [
      {
        evidenceKind: 'validation',
        evidenceFreshness: 'fresh',
        details: {
          kind: 'test',
          freshness: 'fresh',
          validationPasses: ['build'],
          commandRuns: [
            {
              command: 'ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build',
              exitCode: 0,
              stdoutSha256: 'a1b2c3d4',
              stderrSha256: 'e5f6g7h8',
              validators: ['build']
            }
          ]
        }
      }
    ],
    touchedFiles: [],
    deliveryCommit: null
  });

  assert.equal(result.rerunPlan.validators.length, 0);
  assert.equal(result.status, 'fresh');
  assert.equal(result.validators[0]?.status, 'fresh');
});

test('runner sync receipt bridge: unpublished/draft receipt fails closed as stale/absent', () => {
  const draftBundle = [
    {
      evidenceKind: 'validation',
      evidenceFreshness: 'draft',
      details: {
        kind: 'test',
        freshness: 'draft',
        validationPasses: ['build'],
        commandRuns: [
          {
            command: 'ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build',
            exitCode: 1,
            stdoutSha256: 'a1b2c3d4',
            stderrSha256: 'e5f6g7h8',
            validators: ['build']
          }
        ]
      }
    }
  ];

  const state = classifyValidatorEvidenceState(draftBundle, 'build');
  assert.notEqual(state, 'pass');
});

