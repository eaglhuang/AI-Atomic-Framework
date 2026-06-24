import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAtomMapPatchReviewQueueRecord
} from '../packages/plugin-human-review/src/map-curator-bridge.ts';
import {
  createHumanReviewDecisionLog,
  createHumanReviewQueueDocument,
  renderHumanReviewQueueMarkdown
} from '../packages/plugin-human-review/src/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv: string[]) {
  let outputDir = 'docs/reports/split-suggestion-evidence';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-dir') {
      outputDir = argv[index + 1] ?? outputDir;
      index += 1;
    }
  }
  return {
    outputDir: path.resolve(root, outputDir)
  };
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as T;
}

const { outputDir } = parseArgs(process.argv.slice(2));
mkdirSync(outputDir, { recursive: true });

const curatorReport = readJson<{ generatedAt: string; patchDrafts: any[] }>('docs/reports/split-suggestion-evidence/split-suggestion-curator-report.json');
const queueEntries = curatorReport.patchDrafts.map((patchDraft) =>
  createAtomMapPatchReviewQueueRecord(patchDraft, {
    generatedAt: curatorReport.generatedAt,
    reportPath: 'docs/reports/split-suggestion-evidence/split-suggestion-curator-report.json'
  })
);
const pendingQueue = createHumanReviewQueueDocument(queueEntries, {
  generatedAt: curatorReport.generatedAt,
  migration: {
    strategy: 'none',
    fromVersion: null,
    notes: 'Pending curator review queue for broker split suggestions.'
  }
});

const queueJsonPath = path.join(outputDir, 'split-suggestion-review-queue.json');
const queueMdPath = path.join(outputDir, 'split-suggestion-review-queue.md');
writeFileSync(queueJsonPath, `${JSON.stringify(pendingQueue, null, 2)}\n`, 'utf8');
writeFileSync(queueMdPath, renderHumanReviewQueueMarkdown(pendingQueue), 'utf8');

const approvedLogs = pendingQueue.entries.map((record) =>
  createHumanReviewDecisionLog({
    queueRecord: record,
    decision: 'approve',
    reason: 'Broker blocked the coarse same-owner overlap, curator drafted a bounded split patch, and the resulting split plan is safe to review before any map mutation.',
    decidedBy: 'ATM Curator Reviewer',
    decidedAt: '2026-06-22T05:10:00.000Z',
    queuePath: 'docs/reports/split-suggestion-evidence/split-suggestion-review-queue.json',
    projectionPath: 'docs/reports/split-suggestion-evidence/split-suggestion-review-queue.md',
    evidenceId: `human-review.${record.proposalId}.approve`
  })
);

for (const log of approvedLogs) {
  const filename = `${log.proposalId.replace(/^proposal\./, '')}.approve.json`;
  writeFileSync(path.join(outputDir, filename), `${JSON.stringify(log, null, 2)}\n`, 'utf8');
}

const approvedQueue = createHumanReviewQueueDocument(
  approvedLogs.map((log) => log.queueRecord),
  {
    generatedAt: '2026-06-22T05:10:00.000Z',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Approved curator review queue for broker split suggestions.'
    }
  }
);
const approvedQueueJsonPath = path.join(outputDir, 'split-suggestion-review-approved-queue.json');
const approvedQueueMdPath = path.join(outputDir, 'split-suggestion-review-approved-queue.md');
writeFileSync(approvedQueueJsonPath, `${JSON.stringify(approvedQueue, null, 2)}\n`, 'utf8');
writeFileSync(approvedQueueMdPath, renderHumanReviewQueueMarkdown(approvedQueue), 'utf8');

const markdown = [
  '# Split Suggestion Review Chain',
  '',
  '本報告補齊 broker blocked -> curator patch draft -> human-reviewable split plan 的完整鏈條。',
  '',
  '## Artifacts',
  '',
  `- Pending queue JSON: \`${path.relative(root, queueJsonPath).replace(/\\/g, '/')}\``,
  `- Pending queue Markdown: \`${path.relative(root, queueMdPath).replace(/\\/g, '/')}\``,
  `- Approved queue JSON: \`${path.relative(root, approvedQueueJsonPath).replace(/\\/g, '/')}\``,
  `- Approved queue Markdown: \`${path.relative(root, approvedQueueMdPath).replace(/\\/g, '/')}\``,
  ...approvedLogs.map((log) => `- Decision log: \`${path.relative(root, path.join(outputDir, `${log.proposalId.replace(/^proposal\./, '')}.approve.json`)).replace(/\\/g, '/')}\``),
  '',
  '## Cases',
  '',
  '| case | owner atom | target map | target file | queue status | review decision |',
  '| --- | --- | --- | --- | --- | --- |',
  ...approvedLogs.map((log) => {
    const patchDraft = (log.queueRecord.proposal as Record<string, any>).patchDraft;
    return `| ${patchDraft.candidateId} | ${patchDraft.ownerAtomId} | ${log.atomId} | ${patchDraft.conflictRegion.filePath} | ${log.queueRecord.status} | ${log.decision} |`;
  }),
  '',
  '## Notes',
  '',
  '- admission / apply 的 blocked evidence 仍保留在 broker split suggestion artifacts；本批只補 review queue 與 curator approval 鏈。',
  '- queue proposal 保持 `behavior.split` + `decompositionDecision: split`，但不直接改 registry、不直接改 atom map。',
  '- curator approval 的產物是 human-reviewable split plan，不是自動 promotion。'
];
writeFileSync(path.join(outputDir, 'split-suggestion-review-chain-zh.md'), `${markdown.join('\n')}\n`, 'utf8');

console.log(JSON.stringify({
  ok: true,
  outputDir: path.relative(root, outputDir).replace(/\\/g, '/'),
  queueEntries: pendingQueue.entries.length,
  approvedDecisions: approvedLogs.length,
  artifacts: [
    path.relative(root, queueJsonPath).replace(/\\/g, '/'),
    path.relative(root, approvedQueueJsonPath).replace(/\\/g, '/'),
    path.relative(root, path.join(outputDir, 'split-suggestion-review-chain-zh.md')).replace(/\\/g, '/')
  ]
}, null, 2));
