import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const repoRoot = resolveFrameworkRoot();
export const defaultRegistrySchemaPath = path.join(repoRoot, 'schemas', 'registry.schema.json');
function resolveFrameworkRoot(moduleUrl = import.meta.url) {
    let cursor = path.dirname(fileURLToPath(moduleUrl));
    let bundledCliRoot = null;
    while (true) {
        const packagePath = path.join(cursor, 'package.json');
        if (existsSync(packagePath)) {
            try {
                const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
                if (manifest.name === 'ai-atomic-framework')
                    return cursor;
                if (manifest.name === '@ai-atomic-framework/cli')
                    bundledCliRoot ??= cursor;
            }
            catch {
                // Keep walking; malformed manifests cannot define the framework root.
            }
        }
        const parent = path.dirname(cursor);
        if (parent === cursor)
            return bundledCliRoot ?? path.resolve(path.dirname(fileURLToPath(moduleUrl)), '../../../../../');
        cursor = parent;
    }
}
export function normalizeProjectPath(repositoryRoot, value) {
    if (!value) {
        return value;
    }
    return toProjectPath(repositoryRoot, resolveProjectPath(repositoryRoot, value));
}
export function normalizeSchemaPath(repositoryRoot, value) {
    if (!value) {
        return value;
    }
    const resolvedPath = resolveProjectPath(repositoryRoot, value);
    const repositoryRelative = toProjectPath(repositoryRoot, resolvedPath);
    if (repositoryRelative.startsWith('schemas/')) {
        return repositoryRelative;
    }
    const frameworkRelative = path.relative(repoRoot, resolvedPath).replace(/\\/g, '/');
    if (frameworkRelative && !frameworkRelative.startsWith('..') && frameworkRelative.startsWith('schemas/')) {
        return frameworkRelative;
    }
    return toPortablePath(resolvedPath);
}
export function resolveProjectPath(repositoryRoot, value) {
    return path.isAbsolute(value)
        ? path.normalize(value)
        : path.resolve(repositoryRoot, value);
}
export function toProjectPath(repositoryRoot, filePath) {
    const relative = path.relative(repositoryRoot, filePath).replace(/\\/g, '/');
    if (!relative || relative.startsWith('..')) {
        return toPortablePath(filePath);
    }
    return relative;
}
export function normalizeStringArray(values) {
    return Array.from(new Set(values.filter(Boolean)));
}
export function toPortablePath(value) {
    return value.replace(/\\/g, '/');
}
