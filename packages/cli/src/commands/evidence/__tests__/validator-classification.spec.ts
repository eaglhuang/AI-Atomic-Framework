import assert from 'node:assert/strict';
import {
  classifyValidatorTier,
  isClosureRequiredValidator,
  normalizeValidatorGateName,
  resolveValidatorExpectedCommand,
  detectAutoLinkedValidator
} from '../validator-classification.ts';

assert.equal(classifyValidatorTier('typecheck'), 'focused');
assert.equal(classifyValidatorTier('doctor'), 'batch');
assert.equal(classifyValidatorTier('validate:root-drop-release'), 'release');

assert.equal(normalizeValidatorGateName('npm run typecheck'), 'typecheck');
assert.equal(resolveValidatorExpectedCommand('typecheck'), 'npm run typecheck');
assert.equal(detectAutoLinkedValidator('npm run typecheck'), 'typecheck');

assert.equal(isClosureRequiredValidator('doctor', []), false);
assert.equal(isClosureRequiredValidator('typecheck', []), true);
assert.equal(isClosureRequiredValidator('validate:cli', [], ['docs/readme.md']), false);
assert.equal(isClosureRequiredValidator('validate:cli', [], ['packages/cli/src/commands/evidence.ts']), true);
assert.equal(isClosureRequiredValidator('custom-gate', ['custom-gate']), true);

console.log('[validator-classification.spec] ok');
