import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliPackage = JSON.parse(readFileSync(path.join(root, 'packages/cli/package.json'), 'utf8'));
const validator = readFileSync(path.join(root, 'scripts/validate-adopter-artifact-manifest.ts'), 'utf8');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(JSON.stringify(cliPackage.files) === JSON.stringify(['dist']), 'CLI npm package must not publish src.');
assert(cliPackage.atmArtifactBudget?.schemaId === 'atm.cliArtifactBudget.v1', 'CLI must seal an artifact budget.');
assert(cliPackage.atmArtifactBudget?.ownerApprovedDependencyRevision?.revisedBudget, 'Budget revision must be explicit and reviewable.');
assert(validator.includes('forbidden adopter files'), 'Validator must reject tests, fixtures, and evidence from the runtime artifact.');
assert(validator.includes('exceeds approved budget'), 'Validator must enforce the revised caps.');
console.log('[adopter-artifact-budget] ok');
