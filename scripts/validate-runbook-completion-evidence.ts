import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DEFAULT_OUTPUT, DEFAULT_PLANNING_ROOT, RUNBOOK_RELATIVE_PATH, parseRunbook } from './compile-runbook-completion-evidence.ts';

export function validateReport(report: any, source: string): void {
  const ancestry = new Map<string, boolean>();
  const parsed = parseRunbook(source);
  if (report.schemaId !== 'atm.runbookCompletionEvidence.v1') throw new Error('wrong schema');
  if (report.rows.length !== parsed.rows.length || report.expectedItemCount !== parsed.rows.length) throw new Error('runbook item count drift');
  if (new Set(report.rows.map((row: any) => row.itemId)).size !== report.rows.length) throw new Error('duplicate item IDs');
  for (const expected of parsed.rows) {
    const row = report.rows.find((candidate: any) => candidate.itemId === expected.itemId);
    if (!row || row.requirementDigest !== expected.requirementDigest || row.sourceLine !== expected.sourceLine) throw new Error(`missing or stale row ${expected.itemId}`);
    if (row.status === 'proven' && (!Array.isArray(row.evidence) || row.evidence.length === 0)) throw new Error(`caller-authored green ${row.itemId}`);
    for (const tuple of row.evidence ?? []) {
      if (tuple.exitCode !== 0 || !/^sha256:[0-9a-f]{64}$/.test(tuple.outputDigest)) throw new Error(`invalid command receipt ${row.itemId}`);
      if (!tuple.artifactPaths?.length || tuple.artifactPaths.some((path: string) => !existsSync(path))) throw new Error(`missing durable artifact ${row.itemId}`);
      if (!/^[0-9a-f]{40}$/.test(tuple.sourceCommit)) throw new Error(`invalid source commit ${row.itemId}`);
      try {
        const key = `${tuple.sourceCommit}:${report.authority.targetHead}`;
        if (!ancestry.has(key)) {
          execFileSync('git', ['merge-base', '--is-ancestor', tuple.sourceCommit, report.authority.targetHead], { stdio: 'ignore' });
          ancestry.set(key, true);
        }
      } catch {
        throw new Error(`stale or unrelated source commit ${row.itemId}`);
      }
    }
  }
  const all = [...report.rows, ...report.waveExits];
  const calculatedUnresolved = all.filter((row: any) => row.status !== 'proven').map((row: any) => row.itemId);
  if (JSON.stringify(report.unresolvedIds) !== JSON.stringify(calculatedUnresolved)) throw new Error('unresolved item list drift');
  if ((report.unknownIds ?? []).some((id: string) => !calculatedUnresolved.includes(id))) throw new Error('unknown item marked proven');
  for (const row of report.waveExits) {
    const basis = report.rows.filter((candidate: any) => candidate.wave === row.wave);
    if (row.status === 'proven' && (!row.evidence?.length || basis.some((candidate: any) => candidate.status !== 'proven'))) throw new Error(`wave exit lacks independent evidence ${row.itemId}`);
  }
  if (report.overallVerdict === 'complete' && all.some((row: any) => row.status !== 'proven')) throw new Error('complete verdict with non-proven row');
  if ([report.authority.planningHead, report.authority.targetHead, report.authority.originMain].some((value: string) => !/^[0-9a-f]{40}$/.test(value))) throw new Error('unknown or invalid provenance SHA');
}

if (process.argv[1]?.endsWith('validate-runbook-completion-evidence.ts')) {
  const source = readFileSync(resolve(DEFAULT_PLANNING_ROOT, RUNBOOK_RELATIVE_PATH), 'utf8');
  const report = JSON.parse(readFileSync(DEFAULT_OUTPUT, 'utf8'));
  validateReport(report, source);
  console.log(`[validate-runbook-completion-evidence] ok verdict=${report.overallVerdict} rows=${report.rows.length}`);
}
