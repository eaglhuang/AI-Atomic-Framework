import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
export const identityMetadataByteLimit = 1024 * 1024;
/** Fixed, shallow observations. A package label alone is never positive identity.
 * This is repository classification, not authentication or write authority. */
export function inspectFrameworkIdentity(repositoryRoot) {
    const root = path.resolve(repositoryRoot);
    const pkg = readIdentityJson(path.join(root, 'package.json'));
    const name = typeof pkg?.name === 'string' ? pkg.name : null;
    const named = name === 'ai-atomic-framework' || name === '@ai-atomic-framework/root';
    const workspace = Array.isArray(pkg?.workspaces) && pkg.workspaces.includes('packages/*');
    const markers = ['packages/core/src/index.ts', 'packages/cli/src/atm.ts', 'atomic-registry.json'];
    const present = markers.filter(file => isPlainIdentityFile(path.join(root, file)));
    const signals = [...(named ? [`package-name:${name}`] : []), ...present, ...(workspace ? ['workspace:packages/*'] : [])];
    const release = readIdentityJson(path.join(root, 'release-manifest.json'));
    const distribution = typeof release?.schemaVersion === 'string' && release.schemaVersion.startsWith('atm.rootDropRelease.');
    if (distribution)
        signals.push('release:root-drop');
    const kind = distribution ? 'distribution'
        : (named && present.length >= 2) || (workspace && present.length === markers.length) ? 'framework'
            : named || (workspace && present.length >= 1) ? 'ambiguous' : 'adopter';
    // A distribution label may classify the entry, but cannot remove source
    // governance. An injected manifest must never downgrade a framework guard.
    const isFrameworkRepo = named || (workspace && present.length >= 1);
    return { kind, isFrameworkRepo, score: signals.length, root, name, signals };
}
export function isPlainIdentityFile(file) {
    try {
        const stat = lstatSync(file);
        return stat.isFile() && !stat.isSymbolicLink() && identityPathKey(realpathSync(file)) === identityPathKey(file);
    }
    catch {
        return false;
    }
}
function identityPathKey(file) {
    const resolved = path.resolve(file);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
export function readIdentityJson(file) {
    try {
        if (!isPlainIdentityFile(file) || lstatSync(file).size > identityMetadataByteLimit)
            return null;
        const value = JSON.parse(readFileSync(file, 'utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    }
    catch {
        return null;
    }
}
