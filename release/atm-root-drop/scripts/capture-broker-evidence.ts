import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { asBoolean, asInt, asStringCsvList, asStringList, getArgs, parseDefaultRunDirs, parseOutputDir, parseOutputFile, parseTeamRunDirs } from './capture-broker-evidence/args.ts';
import { buildCommandDigest, runCommands, sleep } from './capture-broker-evidence/commands.ts';
import { collectTaskArtifacts } from './capture-broker-evidence/summaries.ts';
import { applyFilters, buildReport, parseFilters, parseTaskIdsFromRows, printHelp, readRunSummariesByDirs } from './capture-broker-evidence/selection-and-report.ts';
import type { BrokerRunSummary, CapturePayload, CommandResult } from './capture-broker-evidence/types.ts';

async function main() {
  const args = getArgs(process.argv.slice(2));
  if (args['--help'] || args['-h']) {
    printHelp();
    return;
  }

  const runDirs = parseDefaultRunDirs(args['--run-dir']);
  const teamRunDirs = parseTeamRunDirs(args['--team-run-dir']);
  const outputDir = parseOutputDir(args['--output-dir'], path.join(runDirs[0] ?? process.cwd(), 'broker-capture'));
  const jsonOutput = parseOutputFile(args['--json-output'], path.join(outputDir, 'broker-capture.json'));
  const reportOutput = parseOutputFile(args['--report-output'], path.join(outputDir, 'broker-capture.md'));
  const runFilter = asStringCsvList(args['--run-ids']);
  const taskFilter = asStringCsvList(args['--task-ids']);
  const commandList = asStringList(args['--command']);
  const awaitNew = asInt(args['--await-new'], 0);
  const timeoutMs = asInt(args['--timeout-ms'], 600000);
  const pollMs = asInt(args['--poll-ms'], 2000);
  const settleMs = asInt(args['--settle-ms'], 1500);
  const strict = asBoolean(args['--strict'], true);
  const failOnCommand = asBoolean(args['--fail-on-command-failure'], true);
  const atmRoot = path.resolve(typeof args['--atm-root'] === 'string' && args['--atm-root'].trim() ? args['--atm-root'] : process.cwd());

  const filter = parseFilters(runFilter, taskFilter);
  const captureOnlyNew = commandList.length > 0 || awaitNew > 0;

  const baselineRuns = readRunSummariesByDirs(runDirs, teamRunDirs);
  const baseline = new Set(baselineRuns.keys());
  const commandLog: CommandResult[] = [];
  const commandStartAt = Date.now();

  const commandPromise = runCommands(commandList).then((results) => {
    commandLog.push(...results);
    if (failOnCommand) {
      const failed = results.find((result) => result.exitCode !== 0);
      if (failed) {
        console.error(`[capture-broker-evidence] command failed: ${failed.command}`);
        console.error(failed.stderr || failed.stdout);
        process.exit(failed.exitCode || 1);
      }
    }
  });

  const captureStart = Date.now();
  let candidates = new Map<string, BrokerRunSummary>();
  let iteration = 0;

  while (Date.now() - captureStart < timeoutMs && (awaitNew === 0 || candidates.size < awaitNew)) {
    iteration += 1;
    const allRuns = readRunSummariesByDirs(runDirs, teamRunDirs);
    const rows = applyFilters(Array.from(allRuns.values()), filter);
    const newRows = rows.filter((row) => !baseline.has(row.runId));
    candidates = new Map(newRows.map((row) => [row.runId, row]));

    if (awaitNew > 0 && candidates.size < awaitNew) {
      await sleep(pollMs);
    }

    if (iteration === 1 && awaitNew === 0) {
      break;
    }
  }

  if (settleMs > 0) {
    await sleep(settleMs);
  }

  await commandPromise;

  const finalRuns = readRunSummariesByDirs(runDirs, teamRunDirs);
  const filteredRuns = applyFilters(Array.from(finalRuns.values()), filter);
  const selected = filteredRuns.filter((row) => (captureOnlyNew ? !baseline.has(row.runId) : true));

  if (awaitNew > 0 && selected.length < awaitNew) {
    console.error(`[capture-broker-evidence] timeout waiting for new runs, found ${selected.length}/${awaitNew} in ${timeoutMs}ms`);
    process.exit(1);
  }

  const dedupedRows = new Map<string, BrokerRunSummary>();
  for (const row of selected) {
    if (!dedupedRows.has(row.runId)) {
      dedupedRows.set(row.runId, row);
    }
  }
  const finalRows = [...dedupedRows.values()].sort((left, right) => left.runId.localeCompare(right.runId));

  const missing = finalRows.filter((row) => row.requiredFields.length > 0);
  if (strict && missing.length > 0) {
    for (const row of missing) {
      console.error(`[capture-broker-evidence] runId=${row.runId} missing required fields: ${row.requiredFields.join(',')}`);
    }
    process.exit(1);
  }

  const taskIds = parseTaskIdsFromRows(finalRows);
  const taskArtifacts = collectTaskArtifacts(atmRoot, taskIds, teamRunDirs);

  mkdirSync(outputDir, { recursive: true });

  const payload: CapturePayload = {
    schemaId: 'atm.brokerCaptureBundle.v1',
    specVersion: '0.1.0',
    generatedAt: new Date().toISOString(),
    sourceRunDirs: runDirs.map((runDir) => runDir.replace(/\\/g, '/')),
    sourceTeamRunDirs: teamRunDirs.map((teamRunDir) => teamRunDir.replace(/\\/g, '/')),
    sourceAtmRoot: atmRoot.replace(/\\/g, '/'),
    commandLog,
    capturedFor: {
      awaitRuns: awaitNew,
      timeoutMs,
      pollMs,
      settleMs,
      runFilters: runFilter,
      taskFilters: taskFilter,
      teamRunDirs: teamRunDirs.map((teamRunDir) => teamRunDir.replace(/\\/g, '/'))
    },
    runs: finalRows,
    taskArtifacts
  };

  writeFileSync(jsonOutput, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  writeFileSync(reportOutput, buildReport(finalRows, taskArtifacts), 'utf8');

  const statusMessage = [
    `[capture-broker-evidence] runs=${finalRows.length}`,
    `commands=${commandLog.length} (${buildCommandDigest(commandLog)})`,
    `durationMs=${Date.now() - commandStartAt}`,
    `json=${jsonOutput}`,
    `report=${reportOutput}`
  ];
  console.log(statusMessage.join(' '));

  if (strict && captureOnlyNew && finalRows.length === 0) {
    console.error('[capture-broker-evidence] no new runs were captured');
    process.exit(1);
  }
}

void main();
