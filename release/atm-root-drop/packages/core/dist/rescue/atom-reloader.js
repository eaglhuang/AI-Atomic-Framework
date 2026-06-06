import { brotliDecompressSync } from 'node:zlib';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { verifyPayloadHash } from '../registry/atom-capsule.js';
export function reloadAtomsFromCapsules(repositoryRoot, options = {}) {
    const dryRun = options.dryRun ?? true;
    const vendorDir = path.join(repositoryRoot, 'vendor', 'atoms');
    const backupDir = options.backupDir ?? path.join(repositoryRoot, '.atm', 'rescue-backup');
    const result = {
        dryRun,
        backedUpTo: null,
        restoredFiles: [],
        skippedCapsules: [],
        errors: []
    };
    if (!existsSync(vendorDir)) {
        result.errors.push(`vendor/atoms/ not found at ${vendorDir}`);
        return result;
    }
    const capsuleFiles = readdirSync(vendorDir).filter((f) => f.endsWith('.json') && f !== 'capsule-registry.json');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    let backupCreated = false;
    for (const filename of capsuleFiles) {
        const filePath = path.join(vendorDir, filename);
        try {
            const content = JSON.parse(readFileSync(filePath, 'utf-8'));
            const cid = content.cid;
            const compressedPayload = content.compressedPayload;
            const bundle = content.bundle;
            if (!cid?.startsWith('atom:cid:')) {
                result.skippedCapsules.push(`${filename}: no atom:cid`);
                continue;
            }
            let sourceCode = null;
            // Try to get source from compressedPayload first
            if (compressedPayload) {
                if (!verifyPayloadHash(cid, compressedPayload)) {
                    result.errors.push(`${filename}: hash mismatch, skipping source restore`);
                    continue;
                }
                try {
                    const compressed = Buffer.from(compressedPayload, 'base64');
                    const decompressed = JSON.parse(brotliDecompressSync(compressed).toString('utf-8'));
                    sourceCode = decompressed.canonicalSourceCode ?? null;
                }
                catch {
                    result.skippedCapsules.push(`${filename}: failed to decompress payload`);
                    continue;
                }
            }
            else if (bundle?.canonicalSourceCode) {
                // Fall back to inline bundle
                sourceCode = bundle.canonicalSourceCode;
            }
            if (!sourceCode) {
                result.skippedCapsules.push(`${filename}: no source code recoverable`);
                continue;
            }
            // Determine restore path: try to find existing source paths from atomic-registry.json
            const atomId = bundle?.atomId ?? filename.replace('.json', '');
            const registryPath = path.join(repositoryRoot, 'atomic-registry.json');
            let restorePath = null;
            if (existsSync(registryPath)) {
                const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
                const entry = registry.entries?.[atomId];
                const codePaths = entry?.selfVerification?.sourcePaths?.code ?? [];
                if (codePaths.length > 0) {
                    restorePath = path.resolve(repositoryRoot, codePaths[0]);
                }
            }
            if (!restorePath) {
                // Fallback: restore to vendor/atoms/source/<atomId>.ts
                restorePath = path.join(repositoryRoot, 'vendor', 'atoms', 'source', `${atomId}.ts`);
            }
            if (!dryRun) {
                // Backup existing file if present
                if (existsSync(restorePath)) {
                    if (!backupCreated) {
                        mkdirSync(path.join(backupDir, ts, 'atom-sources'), { recursive: true });
                        backupCreated = true;
                        result.backedUpTo = path.join(backupDir, ts);
                    }
                    const backupFilePath = path.join(backupDir, ts, 'atom-sources', path.basename(restorePath));
                    writeFileSync(backupFilePath, readFileSync(restorePath));
                }
                mkdirSync(path.dirname(restorePath), { recursive: true });
                writeFileSync(restorePath, sourceCode, 'utf-8');
            }
            result.restoredFiles.push({ atomId, filePath: restorePath });
        }
        catch (err) {
            result.errors.push(`${filename}: unexpected error — ${err}`);
        }
    }
    return result;
}
