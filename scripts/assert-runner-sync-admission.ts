import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertRunnerSyncAdmission,
  inspectRunnerSyncAdmission
} from '../packages/cli/src/commands/framework-development/runner-sync-admission.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const actorId = process.env.ATM_ACTOR_ID?.trim()
  || process.env.AGENT_IDENTITY?.trim()
  || 'release-steward';
const sealedSourceSha = readGitScalar(['rev-parse', '--verify', 'HEAD']);

try {
  assertRunnerSyncAdmission(inspectRunnerSyncAdmission({
    cwd: repoRoot,
    stewardActorId: actorId,
    sealedSourceSha
  }));
} catch (error) {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code)
    : 'ATM_RUNNER_SYNC_ADMISSION_FAILED';
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({
    ok: false,
    code,
    message,
    requiredCommand: 'node atm.mjs broker runner-sync enqueue --task <task-id> --actor <actor-id> --sealed-source-sha <sha> --surface release/atm-onefile/atm.mjs --surface release/atm-root-drop --json'
  }, null, 2));
  process.exitCode = 1;
}

function readGitScalar(args: readonly string[]): string | null {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0 || result.error) return null;
  return result.stdout.trim() || null;
}
