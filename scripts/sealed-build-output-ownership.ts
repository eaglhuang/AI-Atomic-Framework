import type { BuildTarget } from './run-sealed-runner-build.ts';

/** Returns whether a queue-authorized sealed build owns this generated output. */
export function isSealedBuildOutputPath(filePath: string, buildTarget: BuildTarget): boolean {
  const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  return ((buildTarget === 'full' || buildTarget === 'onefile') && normalized.startsWith('release/atm-onefile/'))
    || ((buildTarget === 'full' || buildTarget === 'root-drop') && normalized.startsWith('release/atm-root-drop/'))
    || ((buildTarget === 'full' || buildTarget === 'packages') && /^packages\/[^/]+\/dist\//.test(normalized));
}
