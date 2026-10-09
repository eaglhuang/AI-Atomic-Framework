export const runtimeIdentityReadLimits = Object.freeze({
    maxMembers: 4096,
    maxMemberBytes: 32 * 1024 * 1024,
    maxTotalBytes: 64 * 1024 * 1024,
    maxPathCharacters: 4096,
    chunkBytes: 64 * 1024
});
export function isRuntimePackageVersion(value) {
    return typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}
export function assertNoRuntimeFilePrefixCollisions(paths) {
    const sorted = [...paths].sort();
    for (const file of sorted) {
        const prefix = `${file}/`;
        let low = 0;
        let high = sorted.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (sorted[middle] < prefix)
                low = middle + 1;
            else
                high = middle;
        }
        if (sorted[low]?.startsWith(prefix))
            throw new Error('file/directory prefix collision');
    }
}
/** Shared by filesystem diagnostics and the embedded onefile. The renderer
 * embeds these pure verification functions and fixed limits without imports. */
export function verifyRuntimeBuildIdentity(identity, packageVersion, runtimeEntry, readMember, hash, limits = runtimeIdentityReadLimits) {
    if (!isRuntimePackageVersion(packageVersion) || !identity || typeof identity !== 'object' || Array.isArray(identity))
        throw new Error('invalid metadata');
    const record = identity;
    const { buildId, ...content } = record;
    if (record.schemaId !== 'atm.runtimeBuildIdentity.v1' || record.packageName !== '@ai-atomic-framework/cli'
        || record.version !== packageVersion || typeof record.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(record.sourceCommit)
        || typeof record.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(record.sourceDigest)
        || typeof buildId !== 'string' || !/^[a-f0-9]{64}$/.test(buildId) || buildId !== hash(JSON.stringify(content))
        || !Array.isArray(record.files) || record.files.length === 0 || record.files.length > limits.maxMembers)
        throw new Error('invalid metadata');
    const seen = new Set();
    const members = [];
    for (const value of record.files) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error('invalid member');
        const file = value;
        if (typeof file.path !== 'string' || file.path.length > limits.maxPathCharacters || /^[A-Za-z]:/.test(file.path) || file.path.includes('\\') || file.path.includes('\0')
            || file.path.split('/').some(part => part === '' || part === '.' || part === '..') || seen.has(file.path)
            || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256))
            throw new Error('invalid member');
        seen.add(file.path);
        members.push({ path: file.path, sha256: file.sha256 });
    }
    assertNoRuntimeFilePrefixCollisions(seen);
    let remainingBytes = limits.maxTotalBytes;
    for (const file of members) {
        const member = readMember(file.path, remainingBytes);
        if (!Number.isSafeInteger(member.bytes) || member.bytes < 0 || member.bytes > limits.maxMemberBytes
            || member.bytes > remainingBytes)
            throw new Error('runtime identity byte budget exceeded');
        remainingBytes -= member.bytes;
        if (member.digest !== file.sha256)
            throw new Error('runtime bytes differ');
    }
    if (!seen.has(runtimeEntry))
        throw new Error('runtime entry missing');
    return { sourceCommit: record.sourceCommit, sourceDigest: record.sourceDigest, buildId };
}
