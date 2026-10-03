export type RunnerModeClass = 'frozen' | 'npm-package' | 'source-first' | 'source-import' | 'unknown';

export function classifyRunnerMode(entrypoint: string | null): RunnerModeClass {
  if (!entrypoint) return 'unknown';
  const normalized = entrypoint.replace(/\\/g, '/');
  if (normalized.includes('node_modules/@ai-atomic-framework/cli/')
    || normalized.endsWith('node_modules/.bin/atm')
    || normalized.endsWith('node_modules/.bin/atm.cmd')) return 'npm-package';
  if (normalized === 'atm.dev.mjs') return 'source-first';
  if (normalized === 'atm.mjs'
    || normalized === 'release/atm-onefile/atm.mjs'
    || normalized === 'packages/cli/dist/atm.js'
    || normalized === 'release/atm-root-drop/atm.mjs'
    || normalized.includes('/atm-onefile-cache/')) {
    return 'frozen';
  }
  if (normalized.startsWith('scripts/') || normalized.includes('/scripts/') || normalized.includes('/packages/cli/src/')) {
    return 'source-import';
  }
  return 'unknown';
}

export function governanceCommandPrefix(entrypoint: string | null, platform = process.platform): string {
  if (entrypoint && classifyRunnerMode(entrypoint) === 'npm-package') {
    // A shared installation need not be a dependency of the selected project.
    // Reuse the executing entrypoint; npm exec may otherwise fetch an unrelated
    // package named "atm" or fail when the consumer is offline.
    const runtime = path.isAbsolute(entrypoint) || path.win32.isAbsolute(entrypoint)
      ? entrypoint : path.resolve(entrypoint);
    // Windows command guidance targets PowerShell; single-quoted literals do
    // not expand dollar expressions or environment variables.
    const quoted = /^[A-Za-z0-9_@./:-]+$/.test(runtime) ? runtime
      : platform === 'win32' ? `'${runtime.replace(/'/g, "''")}'`
      : `'${runtime.replace(/'/g, `'"'"'`)}'`;
    return `node ${quoted}`;
  }
  return 'node atm.mjs';
}
import path from 'node:path';
