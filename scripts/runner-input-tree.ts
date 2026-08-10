import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isRunnerGeneratedOutputPath, RUNNER_INPUT_TREE_PATHS } from '../packages/core/src/broker/runner-version-contract.ts';

function excludeGeneratedOutputEntries(tree: Buffer): Buffer {
  return Buffer.concat(tree.toString('utf8').split('\0').filter((entry) => {
    const tab = entry.indexOf('\t');
    return tab < 0 || !isRunnerGeneratedOutputPath(entry.slice(tab + 1));
  }).map((entry) => Buffer.from(`${entry}\0`)));
}

/** Pure sealed-input digest boundary shared by runner build and close validation. */
export function computeBuildInputsTreeHash(cwd: string, commitSha = 'HEAD'): string {
  const result = spawnSync('git', ['ls-tree', '-r', '-z', commitSha, '--', ...RUNNER_INPUT_TREE_PATHS], {
    cwd, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe']
  });
  if ((result.status ?? 1) !== 0 || result.error) {
    throw new Error(`Unable to compute sealed build input tree hash: ${String(result.stderr || result.error || '')}`);
  }
  return `sha256:${createHash('sha256').update(excludeGeneratedOutputEntries(result.stdout)).digest('hex')}`;
}
