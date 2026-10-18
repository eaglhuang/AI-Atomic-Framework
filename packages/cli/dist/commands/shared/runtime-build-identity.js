import { readIdentityJson } from '../../_vendor/core/dist/project/framework-identity.js';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRuntimePackageVersion, runtimeIdentityReadLimits, verifyRuntimeBuildIdentity } from './runtime-build-identity-verifier.js';
export { runtimeIdentityReadLimits } from './runtime-build-identity-verifier.js';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Identity inspection is a bounded diagnostic, never an arbitrary file reader.
// The current full distribution is approximately 16 MiB / 1,600 members; npm
// has a stricter package artifact budget. These ceilings also bound hostile or
// corrupted manifests without allocating from metadata-controlled sizes.
function hashRuntimeMember(file, root, remainingBytes) {
    const before = lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || !realpathSync(file).startsWith(`${root}${path.sep}`))
        throw new Error('unsafe runtime member');
    const maxBytes = Math.min(runtimeIdentityReadLimits.maxMemberBytes, remainingBytes);
    if (before.size > maxBytes)
        throw new Error('runtime identity byte budget exceeded');
    const fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
    try {
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > maxBytes)
            throw new Error('runtime member changed before read');
        const buffer = Buffer.alloc(runtimeIdentityReadLimits.chunkBytes);
        const hasher = createHash('sha256');
        let bytes = 0;
        while (true) {
            const count = readSync(fd, buffer, 0, Math.min(buffer.length, maxBytes - bytes + 1), null);
            if (count === 0)
                break;
            bytes += count;
            if (bytes > maxBytes)
                throw new Error('runtime identity byte budget exceeded');
            hasher.update(buffer.subarray(0, count));
        }
        const after = fstatSync(fd);
        const current = lstatSync(file);
        if (!current.isFile() || current.dev !== opened.dev || current.ino !== opened.ino || bytes !== opened.size
            || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs)
            throw new Error('runtime member changed during read');
        return { digest: hasher.digest('hex'), bytes };
    }
    finally {
        closeSync(fd);
    }
}
const json = (file) => readIdentityJson(file);
function hasPackageBoundary(file) {
    try {
        lstatSync(file);
        return true;
    }
    catch (error) {
        return error.code !== 'ENOENT';
    }
}
/** The first actual package boundary owns the loaded module. Target cwd,
 * arbitrary ancestors and environment hints cannot provide runtime identity. */
export function resolveRuntimePackage(moduleUrl) {
    let cursor = path.dirname(fileURLToPath(moduleUrl));
    while (true) {
        const manifestFile = path.join(cursor, 'package.json');
        if (hasPackageBoundary(manifestFile)) {
            const pkg = json(manifestFile);
            if (pkg?.name !== '@ai-atomic-framework/cli')
                return null;
            const version = isRuntimePackageVersion(pkg.version) ? pkg.version : null;
            return { installationRoot: cursor, version };
        }
        const parent = path.dirname(cursor);
        if (parent === cursor)
            return null;
        cursor = parent;
    }
}
export function readRuntimeBuildIdentity(moduleUrl) {
    const base = { schemaId: 'atm.runtimeIdentity.v1', packageName: '@ai-atomic-framework/cli' };
    const pkg = resolveRuntimePackage(moduleUrl);
    if (!pkg || !pkg.version)
        return { ...base, status: 'unavailable', executionMode: 'unknown', version: null, sourceCommit: null, sourceDigest: null, buildId: null };
    const relativeModule = path.relative(pkg.installationRoot, fileURLToPath(moduleUrl)).replaceAll('\\', '/');
    const executionMode = relativeModule.startsWith('src/') ? 'source' : relativeModule.startsWith('dist/npm-runtime/') ? 'npm-package' : relativeModule.startsWith('dist/') ? 'distribution' : 'unknown';
    if (executionMode === 'source') {
        // Only read Git from the loaded package's own repository, never the target.
        let sourceCommit = null;
        try {
            const root = path.resolve(pkg.installationRoot, '../..');
            const gitRoot = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            if (realpathSync(gitRoot) === realpathSync(root))
                sourceCommit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        }
        catch { /* Source archives are explicitly unattributed. */ }
        return { ...base, status: 'source-unsealed', executionMode, version: pkg.version, sourceCommit, sourceDigest: null, buildId: null };
    }
    if (executionMode === 'unknown')
        return { ...base, executionMode, version: pkg.version, status: 'unavailable', sourceCommit: null, sourceDigest: null, buildId: null };
    const distributionRoot = path.join(pkg.installationRoot, executionMode === 'npm-package' ? 'dist/npm-runtime' : 'dist');
    const identity = json(path.join(distributionRoot, 'build-identity.json'));
    const unavailable = { ...base, executionMode, version: pkg.version, sourceCommit: null, sourceDigest: null, buildId: null };
    if (!identity)
        return { ...unavailable, status: 'unavailable' };
    try {
        const realDistributionRoot = realpathSync(distributionRoot);
        const verified = verifyRuntimeBuildIdentity(identity, pkg.version, executionMode === 'npm-package' ? 'runtime.mjs' : 'atm.js', (relative, remaining) => hashRuntimeMember(path.join(distributionRoot, relative), realDistributionRoot, remaining), hash);
        return { ...base, executionMode, version: pkg.version, status: 'verified', ...verified };
    }
    catch {
        return { ...unavailable, status: 'mismatch' };
    }
}
