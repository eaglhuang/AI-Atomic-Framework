import path from 'node:path';
import { existsSync } from 'node:fs';
export function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
export const atomIdPattern = /^ATM-[A-Z0-9]+-\d{4}$/;
export const atomIdLikePattern = /ATM-[A-Z0-9]+-\d{4}/;
export const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py']);
export const ignoredDirectoryNames = new Set([
    '.git',
    '.atm',
    '.atm-temp',
    'node_modules',
    'library',
    'Library',
    'temp',
    'Temp',
    'dist',
    'build',
    'release'
]);
export function generatedPathsForRepo(repoPath) {
    if (isFrameworkRepo(repoPath)) {
        return ['packages/core/src/registry/atom-runtime.generated.ts'];
    }
    return ['atomic_workbench/refs/atom-refs.ts', 'atomic_workbench/refs/map-refs.ts'];
}
export function isFrameworkRepo(repoPath) {
    return existsSync(path.join(repoPath, 'packages', 'core', 'src', 'registry'));
}
