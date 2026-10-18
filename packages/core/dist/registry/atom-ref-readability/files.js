import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ignoredDirectoryNames, sourceExtensions } from './types.js';
export { existsSync };
export function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}
export function writeJson(filePath, value) {
    writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
export function readText(filePath) {
    return readFileSync(filePath, 'utf8');
}
export function writeText(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, value, 'utf8');
}
export function walkSourceFiles(repoPath) {
    const files = [];
    walk(repoPath, '');
    return files.sort();
    function walk(root, relativeDir) {
        const absoluteDir = path.join(root, relativeDir);
        for (const entry of safeReadDir(absoluteDir)) {
            if (ignoredDirectoryNames.has(entry)) {
                continue;
            }
            if (relativeDir === 'atomic_workbench' && (entry === 'reports' || entry === 'refs')) {
                continue;
            }
            const relativePath = path.join(relativeDir, entry);
            const absolutePath = path.join(root, relativePath);
            const stats = statSync(absolutePath);
            if (stats.isDirectory()) {
                walk(root, relativePath);
                continue;
            }
            if (stats.isFile() && sourceExtensions.has(path.extname(entry))) {
                files.push(relativePath.replace(/\\/g, '/'));
            }
        }
    }
}
export function safeReadDir(directory) {
    try {
        return readdirSync(directory);
    }
    catch {
        return [];
    }
}
