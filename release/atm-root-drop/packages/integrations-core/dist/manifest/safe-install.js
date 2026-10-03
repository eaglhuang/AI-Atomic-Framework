import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeManifestPath, resolveRepositoryPath, sha256Bytes } from './schema.js';
/** Check every existing component, including dangling links, before any write. */
export function assertNoSymlinkPath(candidate) {
    const absolute = path.resolve(candidate);
    const root = path.parse(absolute).root;
    let current = root;
    for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        try {
            if (lstatSync(current).isSymbolicLink())
                throw new Error(`ATM_SETUP_UNSAFE_PATH: symbolic link: ${current}`);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
    }
}
export function safeInstallPath(root, relative) {
    const result = resolveRepositoryPath(root, normalizeManifestPath(relative));
    assertNoSymlinkPath(result);
    return result;
}
export function readManagedBlocks(manifest) {
    const raw = manifest.metadata?.managedBlocks;
    if (raw === undefined)
        return {};
    if (typeof raw !== 'string')
        throw new Error('ATM_INTEGRATION_INVALID_OWNERSHIP: invalid managedBlocks');
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('ATM_INTEGRATION_INVALID_OWNERSHIP: invalid managedBlocks');
    for (const [file, id] of Object.entries(value)) {
        if (normalizeManifestPath(file) !== file || !manifest.files.some(entry => entry.path === file))
            throw new Error('ATM_INTEGRATION_INVALID_OWNERSHIP: unknown or noncanonical managed file');
        if (id !== manifest.adapterId)
            throw new Error('ATM_INTEGRATION_INVALID_OWNERSHIP: adapter mismatch');
    }
    return value;
}
export function losslessUtf8(bytes) {
    const text = bytes.toString('utf8');
    if (!Buffer.from(text).equals(bytes))
        throw new Error('ATM_INTEGRATION_ENCODING_CONFLICT: preserving non-UTF-8 user bytes');
    return text;
}
export function validateOwnershipManifest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('ATM_INTEGRATION_INVALID_OWNERSHIP: invalid manifest');
    const manifest = value;
    if (manifest.schemaId !== 'atm.integrationInstallManifest' || !/^[a-z0-9-]+$/.test(manifest.adapterId ?? '') || !Array.isArray(manifest.files)) {
        throw new Error('ATM_INTEGRATION_INVALID_OWNERSHIP: invalid manifest header');
    }
    const seen = new Set();
    for (const entry of manifest.files) {
        if (!entry || typeof entry.path !== 'string' || normalizeManifestPath(entry.path) !== entry.path || seen.has(entry.path)
            || !/^sha256:[a-f0-9]{64}$/.test(entry.sha256 ?? '') || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0) {
            throw new Error('ATM_INTEGRATION_INVALID_OWNERSHIP: invalid file record');
        }
        seen.add(entry.path);
    }
    readManagedBlocks(manifest);
}
function markers(id) {
    if (!/^[a-z0-9-]+$/.test(id))
        throw new Error('ATM_INTEGRATION_INVALID_OWNERSHIP: invalid adapter id');
    return { start: `\n<!-- ATM:${id}:BEGIN -->\n`, end: `<!-- ATM:${id}:END -->\n` };
}
export function managedBlock(content, id) {
    const marker = markers(id);
    const start = content.indexOf(marker.start);
    const end = content.indexOf(marker.end);
    const markerCount = content.split(`<!-- ATM:${id}:`).length - 1;
    if (start < 0 && end < 0 && markerCount === 0)
        return null;
    if (start < 0 || end < start || markerCount !== 2
        || content.indexOf(marker.start, start + 1) >= 0 || content.indexOf(marker.end, end + 1) >= 0) {
        throw new Error('ATM_INTEGRATION_MERGE_CONFLICT: malformed or duplicate managed block');
    }
    return { content: content.slice(start + marker.start.length, end), start, end: end + marker.end.length };
}
export function wrapManagedBlock(content, id) {
    const marker = markers(id);
    return `${marker.start}${content}${marker.end}`;
}
const sharedMarkdown = new Set(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md']);
export function planSafeFile(input) {
    const absolute = safeInstallPath(input.root, input.file);
    const previous = existsSync(absolute) ? readFileSync(absolute) : null;
    const next = Buffer.from(input.content);
    const priorRecord = input.previous?.files.find((file) => file.path === input.file);
    const priorBlock = input.previous ? readManagedBlocks(input.previous)[input.file] : undefined;
    if (priorBlock || (previous && sharedMarkdown.has(input.file) && !previous.equals(next)
        && (!priorRecord || sha256Bytes(previous) !== priorRecord.sha256))) {
        // Never turn a locally modified, formerly whole-file managed file into a
        // new user-owned wrapper. Its original ownership must remain auditable.
        if (priorRecord && !priorBlock)
            throw new Error(`ATM_INTEGRATION_MERGE_CONFLICT: modified managed file: ${input.file}`);
        const oldText = previous ? losslessUtf8(previous) : '';
        const existing = managedBlock(oldText, input.adapterId);
        if (existing && sha256Bytes(existing.content) !== (priorRecord?.sha256 ?? sha256Bytes(next))
            && sha256Bytes(existing.content) !== sha256Bytes(next)) {
            throw new Error(`ATM_INTEGRATION_MERGE_CONFLICT: modified managed block: ${input.file}`);
        }
        if (priorBlock && !existing)
            throw new Error(`ATM_INTEGRATION_MERGE_CONFLICT: missing managed block: ${input.file}`);
        const wrapped = wrapManagedBlock(next.toString('utf8'), input.adapterId);
        const merged = existing ? oldText.slice(0, existing.start) + wrapped + oldText.slice(existing.end) : oldText + wrapped;
        return { bytes: Buffer.from(merged), previous, block: true };
    }
    if (previous && !previous.equals(next) && (!priorRecord || sha256Bytes(previous) !== priorRecord.sha256)) {
        throw new Error(`ATM_INTEGRATION_MERGE_CONFLICT: preserve existing file: ${input.file}`);
    }
    return { bytes: next, previous, block: false };
}
/** Optimistic precondition check; this is not an OS-level transaction lock. */
export function assertUnchanged(root, file, expected) {
    const absolute = safeInstallPath(root, file);
    const actual = existsSync(absolute) ? readFileSync(absolute) : null;
    if ((actual === null) !== (expected === null) || (actual && expected && !actual.equals(expected))) {
        throw new Error(`ATM_INTEGRATION_CONCURRENT_CHANGE: ${file}`);
    }
}
