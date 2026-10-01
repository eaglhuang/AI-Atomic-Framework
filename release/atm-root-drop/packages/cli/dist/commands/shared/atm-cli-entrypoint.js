export function classifyRunnerMode(entrypoint) {
    if (!entrypoint)
        return 'unknown';
    const normalized = entrypoint.replace(/\\/g, '/');
    if (normalized.includes('node_modules/@ai-atomic-framework/cli/')
        || normalized.endsWith('node_modules/.bin/atm')
        || normalized.endsWith('node_modules/.bin/atm.cmd'))
        return 'npm-package';
    if (normalized === 'atm.dev.mjs')
        return 'source-first';
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
export function governanceCommandPrefix(entrypoint) {
    return classifyRunnerMode(entrypoint) === 'npm-package' ? 'npm exec -- atm' : 'node atm.mjs';
}
