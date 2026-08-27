import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeExternalBenchmark } from './lib/external-benchmark/runner.ts';
import { renderDecisionMarkdown } from './lib/external-benchmark/report.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const protocolPath = argument('--protocol') ?? path.join(root, 'scripts/fixtures/atm-external-benchmark/manifest.json');
const outputPath = argument('--output');
const rawRunsPath = argument('--raw-runs');
const adjudicationsPath = argument('--adjudications');
const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
const rawRuns = rawRunsPath ? JSON.parse(readFileSync(rawRunsPath, 'utf8')) : [];
const adjudications = adjudicationsPath ? JSON.parse(readFileSync(adjudicationsPath, 'utf8')) : [];
const decision = executeExternalBenchmark(protocol, rawRuns, adjudications);
const markdown = renderDecisionMarkdown(decision);
if (outputPath) writeFileSync(outputPath, markdown, 'utf8');
process.stdout.write(`${JSON.stringify({ protocolPath, decision }, null, 2)}\n`);
