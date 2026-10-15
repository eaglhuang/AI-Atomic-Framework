// Settle ATM receipts after every registered entry point has stopped.
import { readFileSync, writeFileSync } from 'node:fs';
import { reconcileSharedComposeProposal } from '../../../../../packages/core/src/broker/shared-compose-inbox.ts';

interface ReconcileJob {
  inboxDir: string;
  proposalIds: string[];
  outPath: string;
}

const job = JSON.parse(readFileSync(process.argv[2], 'utf8')) as ReconcileJob;
try {
  const receipts = job.proposalIds.map((proposalId) =>
    reconcileSharedComposeProposal({ inboxDir: job.inboxDir, proposalId })
  );
  writeFileSync(job.outPath, JSON.stringify({ ok: true, receipts }));
} catch (error) {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  writeFileSync(job.outPath, JSON.stringify({ ok: false, detail }));
  process.exitCode = 1;
}
