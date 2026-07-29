import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractFrontMatter } from '../../packages/cli/src/commands/tasks/task-import-validators.ts';
import { runTasksImport } from '../../packages/cli/src/commands/tasks/import-orchestrator.ts';

// Regression for the import-fidelity defect that blocked TASK-SKL-0026:
// `extractFrontMatter` overloaded a single "current list key" for both the
// nested object-list container and the item-internal scalar list. Parsing the
// first item's valued fields (e.g. `disposition: extract`) cleared that key, so
// the SECOND `- key:` item fell through to the top-level list branch and
// OVERWROTE the entire `atomizationImpact` object with `[secondItem]`. A
// downstream normalizer then coerced the unexpected array to the empty default,
// dropping ownerAtomOrMap and every extraction candidate. The oversized-file
// extraction claim-admission pathway then could not see the declared intent and
// hard-blocked the claim.

const twoItemCard = [
  '---',
  'task_id: TASK-TEST-8801',
  'atomizationImpact:',
  '  ownerAtomOrMap: atm.validator-runtime',
  '  mapUpdates: []',
  '  extractionCandidates:',
  '    - atom: atm.causal-validator-selector',
  '      pattern: Selection Policy',
  '      source: packages/cli/src/commands/test-catalog.ts',
  '      disposition: extract',
  '    - atom: atm.phase-suite-checkpoint',
  '      pattern: Promotion Gate',
  '      source: packages/core/src/evidence/phase-suite.ts',
  '      disposition: extract',
  '---',
  '# TASK-TEST-8801',
  ''
].join('\n');

// --- Unit: the parser must keep the nested object-list intact ---------------
const parsed = extractFrontMatter(twoItemCard);
const atomizationImpact = parsed?.data.atomizationImpact as Record<string, unknown> | undefined;

assert.ok(
  atomizationImpact && !Array.isArray(atomizationImpact) && typeof atomizationImpact === 'object',
  'atomizationImpact must remain an object, not be overwritten by the second list item'
);
assert.equal(
  atomizationImpact.ownerAtomOrMap,
  'atm.validator-runtime',
  'ownerAtomOrMap must survive multi-item extractionCandidates parsing'
);
const candidates = atomizationImpact.extractionCandidates as Array<Record<string, unknown>> | undefined;
assert.ok(Array.isArray(candidates), 'extractionCandidates must be an array');
assert.equal(candidates?.length, 2, 'both extraction candidates must be preserved');
assert.deepEqual(
  candidates?.map((entry) => entry.atom),
  ['atm.causal-validator-selector', 'atm.phase-suite-checkpoint']
);
assert.deepEqual(
  candidates?.map((entry) => entry.disposition),
  ['extract', 'extract'],
  'each candidate must keep its own disposition'
);
assert.equal(candidates?.[0]?.source, 'packages/cli/src/commands/test-catalog.ts');
assert.equal(candidates?.[1]?.source, 'packages/core/src/evidence/phase-suite.ts');

// --- End-to-end: import must carry the candidates into the task record ------
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-frontmatter-nested-'));
const cardPath = path.join(repo, 'TASK-TEST-8801.task.md');
writeFileSync(cardPath, [
  '---',
  'task_id: TASK-TEST-8801',
  'title: Two extraction candidates',
  'milestone: M',
  'contextMap:',
  '  primary:',
  '    - packages/cli/src/commands/test-catalog.ts',
  'deliverables:',
  '  - packages/cli/src/commands/test-catalog.ts',
  'scopePaths:',
  '  - packages/cli/src/commands/test-catalog.ts',
  'atomizationImpact:',
  '  ownerAtomOrMap: atm.validator-runtime',
  '  mapUpdates: []',
  '  extractionCandidates:',
  '    - atom: atm.causal-validator-selector',
  '      pattern: Selection Policy',
  '      source: packages/cli/src/commands/test-catalog.ts',
  '      disposition: extract',
  '    - atom: atm.phase-suite-checkpoint',
  '      pattern: Promotion Gate',
  '      source: packages/core/src/evidence/phase-suite.ts',
  '      disposition: extract',
  '---',
  '# TASK-TEST-8801',
  '## Acceptance',
  '- ACC-1 keep it correct.',
  ''
].join('\n'), 'utf8');

const imported = await runTasksImport(['--cwd', repo, '--from', cardPath, '--dry-run', '--json']) as any;
assert.equal(imported.ok, true, JSON.stringify(imported.messages ?? imported, null, 2));
const importedTask = imported.evidence.manifest.tasks[0];
assert.equal(importedTask.atomizationImpact?.ownerAtomOrMap, 'atm.validator-runtime');
const importedCandidates = importedTask.atomizationImpact?.extractionCandidates as Array<Record<string, unknown>> | undefined;
assert.equal(importedCandidates?.length, 2, 'imported task must retain both extraction candidates');
assert.deepEqual(
  importedCandidates?.map((entry) => entry.disposition),
  ['extract', 'extract']
);

console.log('[frontmatter-nested-object-list:test] ok');
