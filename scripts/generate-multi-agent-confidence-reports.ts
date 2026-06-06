import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { supportedAgentProfiles } from '../packages/cli/src/commands/agent-confidence.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultsDir = path.join(root, 'tests', 'agents', 'results');
const docsPath = path.join(root, 'docs', 'multi-agent-results.md');
const manifestPath = path.join(resultsDir, 'latest-batch.json');
const timestampArgIndex = process.argv.indexOf('--timestamp');
const batchTimestamp = timestampArgIndex >= 0 && process.argv[timestampArgIndex + 1]
  ? process.argv[timestampArgIndex + 1]
  : new Date().toISOString().replace(/:/g, '-');

function runAtm(args: any) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    parsed: payload ? JSON.parse(payload) : {}
  };
}

mkdirSync(resultsDir, { recursive: true });

const reports = [];
for (const profile of supportedAgentProfiles) {
  const command = ['self-host-alpha', '--verify', '--agent', profile.id, '--json'];
  const result = runAtm(command);
  if (result.exitCode !== 0 || result.parsed.ok !== true) {
    throw new Error(`Failed to generate confidence report for ${profile.id}`);
  }
  const fileName = `${profile.id}-${batchTimestamp}.json`;
  const relativePath = `tests/agents/results/${fileName}`;
  const reportDocument = {
    schemaVersion: 'atm.agentConfidenceReport.v0.1',
    generatedAt: batchTimestamp,
    agentId: profile.id,
    agentLabel: profile.label,
    blockingRelease: false,
    sourceCommand: `node atm.mjs ${command.join(' ')}`,
    result: result.parsed
  };
  writeFileSync(path.join(resultsDir, fileName), `${JSON.stringify(reportDocument, null, 2)}\n`, 'utf8');
  reports.push({
    agentId: profile.id,
    agentLabel: profile.label,
    reportPath: relativePath,
    ok: result.parsed.ok === true,
    confidenceReady: result.parsed.evidence?.confidence?.confidenceReady === true,
    blockers: result.parsed.evidence?.confidence?.blockers ?? []
  });
}

writeFileSync(manifestPath, `${JSON.stringify({
  schemaVersion: 'atm.multiAgentConfidenceBatch.v0.1',
  generatedAt: batchTimestamp,
  advisory: true,
  blockingRelease: false,
  reports
}, null, 2)}\n`, 'utf8');

const summaryLines = [
  '# Multi-Agent Confidence Results',
  '',
  `Generated at: ${batchTimestamp}`,
  '',
  'These reports are advisory only and do not block alpha0 release.',
  '',
  '| Agent | Result | Confidence Ready | Report |',
  '| --- | --- | --- | --- |'
];

for (const report of reports) {
  summaryLines.push(`| ${report.agentLabel} | ${report.ok ? 'pass' : 'fail'} | ${report.confidenceReady ? 'true' : 'false'} | ${report.reportPath} |`);
}

summaryLines.push('', 'If a future agent profile fails, log the failure as an advisory issue and decide separately whether it blocks alpha1.');
writeFileSync(docsPath, `${summaryLines.join('\n')}\n`, 'utf8');

console.log(`[multi-agent-confidence] generated ${reports.length} reports (${batchTimestamp})`);
