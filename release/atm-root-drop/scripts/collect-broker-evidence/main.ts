import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getArgs, parseCsvOption, parseDefaultRunDir, parseOutputDir, parseOutputFile, parseTeamRunDir, printHelp } from './args.ts';
import { collectTaskArtifacts, parseTaskIdsFromRows } from './artifacts.ts';
import { loadGitBoundaryRunSummaries, loadRegistryAdmissionSummaries, loadRunSummaries, loadTeamRunSummaries } from './loaders.ts';
import { buildReport } from './report.ts';
import type { BrokerRunSummary } from './types.ts';

export function main() {
  const args = getArgs(process.argv.slice(2));
  if (args['--help'] || args['-h']) {
    printHelp();
    return;
  }
  const runDir = parseDefaultRunDir(args['--run-dir'] || args['--run-evidence-dir']);
  const teamRunDir = parseTeamRunDir(args['--team-run-dir']);
  const outputDir = parseOutputDir(args['--output-dir'], runDir);
  const jsonOutput = parseOutputFile(args['--json-output'], path.join(outputDir, 'broker-evidence-bundle.json'));
  const reportOutput = parseOutputFile(args['--report-output'], path.join(outputDir, 'broker-evidence-bundle.md'));
  const runFilter = new Set(parseCsvOption(args['--run-ids']));
  const taskFilter = new Set(parseCsvOption(args['--task-ids']));
  const atmRoot = path.resolve(typeof args['--atm-root'] === 'string' ? args['--atm-root'] : process.cwd());

  const rows = [
    ...loadRunSummaries(runDir),
    ...loadTeamRunSummaries(teamRunDir),
    ...loadRegistryAdmissionSummaries(atmRoot),
    ...loadGitBoundaryRunSummaries(atmRoot)
  ]
    .filter((row) => {
      if (runFilter.size > 0 && !runFilter.has(row.runId)) {
        return false;
      }
      if (taskFilter.size > 0) {
        const taskList = row.tasks.split(',').map((entry) => entry.trim()).filter(Boolean);
        return taskList.some((task) => taskFilter.has(task));
      }
      return true;
    })
    .sort((left, right) => left.runId.localeCompare(right.runId));

  const dedupedRows = new Map<string, BrokerRunSummary>();
  for (const row of rows) {
    if (!dedupedRows.has(row.runId)) {
      dedupedRows.set(row.runId, row);
    }
  }
  const uniqRows = [...dedupedRows.values()];

  const taskIds = parseTaskIdsFromRows(uniqRows);
  const taskArtifacts = collectTaskArtifacts(atmRoot, taskIds, teamRunDir);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(jsonOutput, `${JSON.stringify({
    schemaId: 'atm.brokerEvidenceBundle.v1',
    specVersion: '0.1.0',
    generatedAt: new Date().toISOString(),
    sourceRunDir: runDir.replace(/\\/g, '/'),
    sourceTeamRunDir: teamRunDir ? teamRunDir.replace(/\\/g, '/') : null,
    sourceAtmRoot: atmRoot.replace(/\\/g, '/'),
    runs: uniqRows,
    taskArtifacts
  }, null, 2)}\n`, 'utf8');
  writeFileSync(reportOutput, buildReport(uniqRows, taskArtifacts), 'utf8');

  console.log(`[collect-broker-evidence] runs=${uniqRows.length}, tasks=${taskArtifacts.length}, json=${jsonOutput}, report=${reportOutput}`);
}
