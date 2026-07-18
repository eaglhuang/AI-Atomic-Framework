import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, [
  '--strip-types',
  'scripts/validate-physical-line-budget.ts',
  '--json'
], {
  cwd: process.cwd(),
  encoding: 'utf8',
  timeout: 30_000
});

assert.equal(result.status, 0, `physical line-budget gate failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

const report = JSON.parse(result.stdout) as {
  readonly ok: boolean;
  readonly scannedFiles: number;
  readonly maxLines: number;
  readonly softLines: number;
  readonly hardViolationCount: number;
  readonly softWarningCount: number;
  readonly topFile: { readonly file: string; readonly lines: number } | null;
};

assert.equal(report.ok, true);
assert.equal(report.maxLines, 600);
assert.equal(report.softLines, 500);
assert.equal(report.hardViolationCount, 0);
assert.ok(report.scannedFiles > 100, 'gate must scan canonical source roots');
assert.ok(report.topFile && report.topFile.lines <= report.maxLines, 'top scanned file must respect the hard cap');

console.log(`[physical-line-budget-gate] ok scanned=${report.scannedFiles} soft=${report.softWarningCount} top=${report.topFile?.file}:${report.topFile?.lines}`);
