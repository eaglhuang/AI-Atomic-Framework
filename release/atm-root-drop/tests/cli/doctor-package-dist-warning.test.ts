import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDoctor } from '../../packages/cli/src/commands/doctor/run-doctor.ts';

// The framework repository itself: doctor must warn whenever workspace packages
// lack built dist, even though the frozen onefile runner keeps package-dist ok.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const result = await runDoctor(['--cwd', repoRoot, '--json']);
const evidence = result.evidence as Record<string, any>;
const packageDist = (evidence.checks as any[]).find((check) => check.name === 'package-dist');
assert.ok(packageDist, 'doctor reports the package-dist check');
const missingDist: string[] = packageDist.details.missingDist;
const warning = result.messages.find((entry) => entry.code === 'ATM_PACKAGE_DIST_MISSING');

assert.equal(evidence.repoIdentity?.isFrameworkRepo, true);
if (missingDist.length > 0) {
  assert.ok(warning, 'a framework repo with missing package dist gets ATM_PACKAGE_DIST_MISSING');
  assert.equal(warning?.level, 'warning');
  assert.deepEqual((warning?.data as Record<string, unknown>).missingDist, missingDist);
  assert.equal((warning?.data as Record<string, unknown>).requiredCommand, 'npm run build');
} else {
  assert.equal(warning, undefined, 'no warning once every package has built dist');
}

console.log(`ok: doctor package-dist warning matches ${missingDist.length} missing package dist(s)`);
