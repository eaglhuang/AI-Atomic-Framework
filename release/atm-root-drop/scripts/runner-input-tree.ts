import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { filterRunnerInputTreeListing, RUNNER_INPUT_TREE_PATHS } from '../packages/core/src/broker/runner-version-contract.ts';

/** Pure sealed-input digest boundary shared by runner build and close validation. */
export function computeBuildInputsTreeHash(cwd: string, commitSha = 'HEAD'): string {
  const result = spawnSync('git', ['ls-tree', '-r', '-z', commitSha, '--', ...RUNNER_INPUT_TREE_PATHS], {
    cwd, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe']
  });
  if ((result.status ?? 1) !== 0 || result.error) {
    throw new Error(`Unable to compute sealed build input tree hash: ${String(result.stderr || result.error || '')}`);
  }
  return `sha256:${createHash('sha256').update(filterRunnerInputTreeListing(result.stdout.toString('utf8'))).digest('hex')}`;
}
