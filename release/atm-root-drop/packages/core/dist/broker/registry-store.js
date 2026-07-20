import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
export class BrokerRegistryStoreError extends Error {
    code;
    recoveryFact;
    constructor(code, recoveryFact) {
        super(`${code}: ${recoveryFact.message}`);
        this.name = 'BrokerRegistryStoreError';
        this.code = code;
        this.recoveryFact = recoveryFact;
    }
}
export function createEmptyBrokerRegistryDocument(input = {}) {
    return {
        schemaId: 'atm.writeBrokerRegistry.v1',
        specVersion: '0.1.0',
        repoId: input.repoId ?? 'local-repo',
        workspaceId: input.workspaceId ?? 'main',
        currentEpoch: input.currentEpoch ?? Date.now(),
        activeIntents: []
    };
}
export function createBrokerRegistryStore(registryPath) {
    return {
        registryPath,
        read: () => readBrokerRegistrySnapshot(registryPath),
        write: (input) => writeBrokerRegistrySnapshot(registryPath, input)
    };
}
export function readBrokerRegistrySnapshot(registryPath) {
    if (!existsSync(registryPath)) {
        const document = createEmptyBrokerRegistryDocument();
        return {
            schemaId: 'atm.brokerRegistrySnapshot.v1',
            registryPath,
            generation: document.currentEpoch ?? 0,
            digest: digestRegistryDocument(document),
            lastTransactionId: null,
            document
        };
    }
    let parsed;
    const raw = readFileSync(registryPath, 'utf8');
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        throw registryStoreError('ATM_BROKER_REGISTRY_INVALID_JSON', {
            kind: 'invalid-json',
            registryPath,
            message: `Broker registry is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`
        });
    }
    if (!isRegistryDocument(parsed)) {
        throw registryStoreError('ATM_BROKER_REGISTRY_INVALID_SHAPE', {
            kind: 'invalid-shape',
            registryPath,
            message: 'Broker registry must be an atm.writeBrokerRegistry.v1 object with activeIntents.'
        });
    }
    const digest = digestRegistryDocument(parsed);
    const generation = Number.isFinite(parsed.currentEpoch) ? Number(parsed.currentEpoch) : 0;
    const lastTransactionId = typeof parsed.lastTransactionId === 'string'
        ? String(parsed.lastTransactionId)
        : null;
    return {
        schemaId: 'atm.brokerRegistrySnapshot.v1',
        registryPath,
        generation,
        digest,
        lastTransactionId,
        document: parsed
    };
}
export function writeBrokerRegistrySnapshot(registryPath, input) {
    const current = existsSync(registryPath) ? readBrokerRegistrySnapshot(registryPath) : input.base;
    if (current.digest !== input.base.digest || current.generation !== input.base.generation) {
        throw registryStoreError('ATM_BROKER_REGISTRY_CAS_CONFLICT', {
            kind: 'stale-generation',
            registryPath,
            message: `Broker registry CAS rejected stale generation ${input.base.generation}; current generation is ${current.generation}.`,
            observedDigest: current.digest,
            expectedDigest: input.base.digest,
            generation: current.generation
        });
    }
    const nextGeneration = Math.max(Date.now(), input.base.generation + 1);
    const next = {
        ...input.next,
        currentEpoch: nextGeneration,
        lastTransactionId: input.transactionId
    };
    const nextDigest = digestRegistryDocument(next);
    writeAtomicUtf8(registryPath, `${JSON.stringify(next, null, 2)}\n`);
    return {
        schemaId: 'atm.brokerRegistryWriteReceipt.v1',
        transactionId: input.transactionId,
        registryPath,
        baseGeneration: input.base.generation,
        nextGeneration,
        baseDigest: input.base.digest,
        nextDigest,
        committedAt: input.now ?? new Date().toISOString()
    };
}
export function digestRegistryDocument(document) {
    return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(document))).digest('hex')}`;
}
function isRegistryDocument(value) {
    return Boolean(value
        && typeof value === 'object'
        && !Array.isArray(value)
        && value.schemaId === 'atm.writeBrokerRegistry.v1'
        && value.specVersion === '0.1.0'
        && Array.isArray(value.activeIntents));
}
function registryStoreError(code, input) {
    return new BrokerRegistryStoreError(code, {
        schemaId: 'atm.brokerRegistryRecoveryFact.v1',
        failClosed: true,
        ...input
    });
}
function canonicalize(value) {
    if (Array.isArray(value))
        return value.map(canonicalize);
    if (!value || typeof value !== 'object')
        return value;
    return Object.fromEntries(Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]));
}
function writeAtomicUtf8(filePath, content) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let fd = null;
    try {
        fd = openSync(tempPath, 'wx');
        writeFileSync(fd, content, 'utf8');
        fsyncSync(fd);
        closeSync(fd);
        fd = null;
        renameSync(tempPath, filePath);
        fsyncDirectory(dir);
    }
    catch (error) {
        if (fd !== null) {
            try {
                closeSync(fd);
            }
            catch {
                // Best effort cleanup after a failed atomic registry write.
            }
        }
        rmSync(tempPath, { force: true });
        throw error;
    }
}
function fsyncDirectory(dir) {
    let fd = null;
    try {
        fd = openSync(dir, 'r');
        fsyncSync(fd);
    }
    catch {
        // Directory fsync is not available on every host filesystem.
    }
    finally {
        if (fd !== null)
            closeSync(fd);
    }
}
