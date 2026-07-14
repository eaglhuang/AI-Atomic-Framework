import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
export const MICRO_EVIDENCE_RECEIPT_SCHEMA_ID = 'atm.microEvidenceReceipt.v1';
export const VALIDATION_RECEIPT_INDEX_SCHEMA_ID = 'atm.validationReceiptIndex.v1';
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);
const MAX_ATOMIC_WRITE_ATTEMPTS = 3;
export function validationReceiptStoreRoot(cwd) {
    return path.join(cwd, '.atm', 'runtime', 'validation-receipts');
}
export function validationReceiptIndexPath(cwd, reuseKey) {
    return path.join(validationReceiptStoreRoot(cwd), 'index', `${digestFileName(reuseKey)}.json`);
}
export function validationReceiptContentPath(cwd, receiptId) {
    return path.join(validationReceiptStoreRoot(cwd), 'objects', `${digestFileName(receiptId)}.json`);
}
export function buildValidationReceiptInput(input) {
    const scope = buildValidationReceiptScope(input.cwd, input.scopePaths);
    const payloadDigest = sha256Json({
        schemaId: 'atm.validationReceiptPayload.v1',
        validatorName: input.validatorName,
        command: normalizeCommand(input.command),
        status: input.status,
        ok: input.ok,
        result: input.result
    });
    const scopeDigest = sha256Json(scope);
    const reuseKey = sha256Json({
        schemaId: 'atm.validationReceiptReuseKey.v1',
        validatorName: input.validatorName,
        command: normalizeCommand(input.command),
        environment: {
            platform: process.platform,
            nodeVersion: process.version
        },
        base: {
            gitHead: input.gitHead
        },
        scopeDigest
    });
    const receiptId = sha256Json({
        schemaId: 'atm.validationReceiptId.v1',
        reuseKey,
        payloadDigest
    });
    return {
        schemaId: MICRO_EVIDENCE_RECEIPT_SCHEMA_ID,
        receiptId,
        validatorName: input.validatorName,
        command: normalizeCommand(input.command),
        status: input.status,
        ok: input.ok,
        environment: {
            platform: process.platform,
            nodeVersion: process.version
        },
        base: {
            gitHead: input.gitHead
        },
        payloadDigest,
        scopeDigest,
        reuseKey,
        createdAt: input.createdAt ?? new Date().toISOString(),
        result: input.result,
        scope
    };
}
export function writeValidationReceipt(cwd, receipt) {
    const receiptPath = validationReceiptContentPath(cwd, receipt.receiptId);
    const indexPath = validationReceiptIndexPath(cwd, receipt.reuseKey);
    const receiptWrite = writeJsonAtomic(receiptPath, receipt);
    const index = {
        schemaId: VALIDATION_RECEIPT_INDEX_SCHEMA_ID,
        reuseKey: receipt.reuseKey,
        receiptId: receipt.receiptId,
        receiptPath: normalizeRelativePath(cwd, receiptPath),
        updatedAt: new Date().toISOString()
    };
    const indexWrite = writeJsonAtomic(indexPath, index);
    return {
        receipt,
        receiptPath,
        indexPath,
        attempts: Math.max(receiptWrite.attempts, indexWrite.attempts)
    };
}
export function readReusableValidationReceipt(input) {
    const scope = buildValidationReceiptScope(input.cwd, input.scopePaths);
    const reuseKey = sha256Json({
        schemaId: 'atm.validationReceiptReuseKey.v1',
        validatorName: input.validatorName,
        command: normalizeCommand(input.command),
        environment: {
            platform: process.platform,
            nodeVersion: process.version
        },
        base: {
            gitHead: input.gitHead
        },
        scopeDigest: sha256Json(scope)
    });
    const indexPath = validationReceiptIndexPath(input.cwd, reuseKey);
    if (!existsSync(indexPath)) {
        return { reusable: false, receipt: null, reason: 'missing-index', receiptPath: null };
    }
    const index = readJson(indexPath);
    const receiptId = typeof index.receiptId === 'string' ? index.receiptId : '';
    if (!receiptId) {
        return { reusable: false, receipt: null, reason: 'invalid-index', receiptPath: null };
    }
    const receiptPath = validationReceiptContentPath(input.cwd, receiptId);
    if (!existsSync(receiptPath)) {
        return { reusable: false, receipt: null, reason: 'missing-receipt', receiptPath };
    }
    const receipt = readJson(receiptPath);
    if (receipt.schemaId !== MICRO_EVIDENCE_RECEIPT_SCHEMA_ID) {
        return { reusable: false, receipt: null, reason: 'schema-mismatch', receiptPath };
    }
    if (receipt.status !== 'passed' || receipt.ok !== true) {
        return { reusable: false, receipt, reason: 'not-passed', receiptPath };
    }
    if (receipt.validatorName !== input.validatorName || receipt.command !== normalizeCommand(input.command)) {
        return { reusable: false, receipt, reason: 'identity-mismatch', receiptPath };
    }
    if (receipt.reuseKey !== reuseKey || receipt.scopeDigest !== sha256Json(scope)) {
        return { reusable: false, receipt, reason: 'scope-mismatch', receiptPath };
    }
    return { reusable: true, receipt, reason: null, receiptPath };
}
export function garbageCollectValidationReceipts(input) {
    const keepLatestPerKey = Math.max(1, input.keepLatestPerKey ?? 1);
    const indexRoot = path.join(validationReceiptStoreRoot(input.cwd), 'index');
    const objectRoot = path.join(validationReceiptStoreRoot(input.cwd), 'objects');
    if (!existsSync(indexRoot) || !existsSync(objectRoot))
        return { removed: [] };
    const keepIds = new Set();
    for (const fileName of readdirSync(indexRoot).filter((entry) => entry.endsWith('.json'))) {
        const index = readJson(path.join(indexRoot, fileName));
        if (typeof index.receiptId === 'string')
            keepIds.add(index.receiptId);
    }
    const removed = [];
    for (const fileName of readdirSync(objectRoot).filter((entry) => entry.endsWith('.json'))) {
        const receiptId = path.basename(fileName, '.json');
        if (keepIds.has(receiptId) || keepLatestPerKey > 1)
            continue;
        const fullPath = path.join(objectRoot, fileName);
        rmSync(fullPath, { force: true });
        removed.push(normalizeRelativePath(input.cwd, fullPath));
    }
    return { removed };
}
function buildValidationReceiptScope(cwd, scopePaths) {
    const files = [...new Set(scopePaths.map((entry) => normalizePath(entry)).filter(Boolean))]
        .flatMap((entry) => expandScopeEntry(cwd, entry))
        .sort((left, right) => left.localeCompare(right))
        .map((entry) => readScopeFile(cwd, entry));
    return {
        strategy: 'conservative-files',
        files
    };
}
function expandScopeEntry(cwd, entry) {
    const fullPath = path.join(cwd, entry);
    if (!existsSync(fullPath))
        return [entry];
    const stat = statSync(fullPath);
    if (!stat.isDirectory())
        return [entry];
    return readdirRecursive(fullPath)
        .map((filePath) => normalizeRelativePath(cwd, filePath))
        .filter((filePath) => !filePath.includes('/node_modules/'));
}
function readScopeFile(cwd, relativePath) {
    const fullPath = path.join(cwd, relativePath);
    if (!existsSync(fullPath)) {
        return { path: normalizePath(relativePath), sha256: null, mtimeMs: null, size: null, missing: true };
    }
    const stat = statSync(fullPath);
    if (!stat.isFile()) {
        return { path: normalizePath(relativePath), sha256: null, mtimeMs: stat.mtimeMs, size: stat.size, missing: true };
    }
    return {
        path: normalizePath(relativePath),
        sha256: sha256Bytes(readFileSync(fullPath)),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        missing: false
    };
}
function writeJsonAtomic(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    let attempts = 0;
    while (true) {
        attempts += 1;
        try {
            renameSync(tempPath, filePath);
            return { attempts };
        }
        catch (error) {
            const code = error && typeof error === 'object' && 'code' in error ? String(error.code ?? '') : '';
            if (!RETRYABLE_RENAME_CODES.has(code) || attempts >= MAX_ATOMIC_WRITE_ATTEMPTS) {
                try {
                    rmSync(tempPath, { force: true });
                }
                catch { }
                throw error;
            }
            sleepMs(25 * attempts);
        }
    }
}
function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}
function readdirRecursive(dir) {
    const entries = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            entries.push(...readdirRecursive(fullPath));
        }
        else if (entry.isFile()) {
            entries.push(fullPath);
        }
    }
    return entries;
}
function normalizeCommand(value) {
    return value.trim().replace(/\s+/g, ' ');
}
function normalizePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
function normalizeRelativePath(cwd, filePath) {
    return normalizePath(path.relative(cwd, filePath));
}
function digestFileName(value) {
    return value.replace(/^sha256:/, 'sha256-').replace(/[^a-z0-9-]/gi, '-');
}
function sha256Json(value) {
    return sha256Bytes(Buffer.from(JSON.stringify(value)));
}
function sha256Bytes(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
function sleepMs(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
