import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCandidates } from '../candidates.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-candidates-file-'));
mkdirSync(path.join(root, 'src'), { recursive: true });
writeFileSync(path.join(root, 'src', 'single.ts'), 'export function single() { return 1; }\n', 'utf8');

const result = await runCandidates([
  'rank',
  '--cwd', root,
  '--include', 'src/single.ts',
  '--goal', 'rank a single source file',
  '--json'
]);

assert.equal(result.ok, true);
const report = result.evidence.report as { candidateRanking: Array<{ filePath: string }> };
assert.equal(report.candidateRanking.length, 1);
assert.equal(report.candidateRanking[0].filePath, 'src/single.ts');
console.log('[candidates-file-include.spec] ok');
