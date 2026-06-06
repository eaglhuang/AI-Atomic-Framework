import { createHash } from 'node:crypto';
export * from './install-manifest.js';
export { ExperimentalApiError, experimentalApiSchemaVersion, invokeExperimentalApi, listExperimentalApis } from './experimental/index.js';
/**
 * Render a pack's target files against the given context and return a
 * RenderedManifest describing each file's content hash.
 *
 * Pure function — does not write to disk.
 */
export function renderManifest(pack, context) {
    const renderedFiles = pack.targetFiles.map((file) => {
        const content = applyVars(file.template, context.vars ?? {});
        return {
            path: file.path,
            contentHash: sha256(content)
        };
    });
    return {
        packId: pack.packId,
        version: pack.version,
        installedAt: new Date().toISOString(),
        renderedFiles,
        sourceHash: pack.sourceHash ?? sha256(JSON.stringify(pack.targetFiles))
    };
}
/**
 * Hash an array of file content strings and return a single aggregate SHA-256
 * hex digest.
 *
 * Pure function — does not read from disk.
 */
export function hashFiles(contents) {
    return sha256(contents.join('\0'));
}
function sha256(input) {
    return createHash('sha256').update(input, 'utf8').digest('hex');
}
function applyVars(template, vars) {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => vars[key] ?? _match);
}
