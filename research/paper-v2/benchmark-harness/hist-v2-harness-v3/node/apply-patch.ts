// Apply one unified diff with the ATM core applier. Conflict-free or a refusal.
import { readFileSync } from 'node:fs';
import { applyUnifiedPatch } from '../../../../../packages/core/src/broker/unified-patch.ts';

const jobPath = process.argv[2];
if (!jobPath) {
  process.stderr.write('missing job path\n');
  process.exit(2);
}

const job = JSON.parse(readFileSync(jobPath, 'utf8')) as { base: string; patch: string };
try {
  const text = applyUnifiedPatch(job.base, job.patch);
  process.stdout.write(JSON.stringify({ ok: true, text }));
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stdout.write(JSON.stringify({ ok: false, detail }));
  process.exitCode = 2;
}
