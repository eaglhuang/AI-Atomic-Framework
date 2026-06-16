import { brokerAdapterMigration } from '../types.js';
export const JSON_RECORD_ADAPTER_ID = 'json-record';
const SUPPORTED_OPS = ['upsert', 'add-if-absent', 'replace'];
/**
 * Builds the conflict key for a JSON record mutation from the file path and a
 * JSON pointer (RFC 6901-ish, '/' separated). Scope is 'record'.
 */
export function jsonPointerConflictKey(filePath, pointer) {
    const normalizedPointer = pointer.startsWith('/') || pointer === '' ? pointer : `/${pointer}`;
    return {
        schemaId: 'atm.conflictKey.v1',
        specVersion: '0.1.0',
        migration: brokerAdapterMigration(),
        scope: 'record',
        key: `record:${filePath}::${normalizedPointer}`
    };
}
function normalizePointer(pointer) {
    return pointer.startsWith('/') || pointer === '' ? pointer : `/${pointer}`;
}
function decodeToken(token) {
    return token.replace(/~1/g, '/').replace(/~0/g, '~');
}
function pointerSegments(pointer) {
    const normalized = normalizePointer(pointer);
    if (normalized === '') {
        return [];
    }
    return normalized.split('/').slice(1).map(decodeToken);
}
function getAtPointer(root, pointer) {
    let current = root;
    for (const segment of pointerSegments(pointer)) {
        if (current === null || typeof current !== 'object') {
            return { found: false, value: undefined };
        }
        const container = current;
        if (!(segment in container)) {
            return { found: false, value: undefined };
        }
        current = container[segment];
    }
    return { found: true, value: current };
}
function setAtPointer(root, pointer, value) {
    const segments = pointerSegments(pointer);
    if (segments.length === 0) {
        return value;
    }
    const clone = root === null || typeof root !== 'object'
        ? {}
        : Array.isArray(root)
            ? [...root]
            : { ...root };
    let cursor = clone;
    for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        const existing = cursor[segment];
        const child = existing === null || typeof existing !== 'object'
            ? {}
            : Array.isArray(existing)
                ? [...existing]
                : { ...existing };
        cursor[segment] = child;
        cursor = child;
    }
    cursor[segments[segments.length - 1]] = value;
    return clone;
}
/**
 * Generic JSON record adapter (TASK-CID-0093). Mutations address individual
 * records by JSON pointer. Two mutations to different pointers are mergeable;
 * two mutations to the same pointer conflict (JSON record edits are not
 * commutative). Supports upsert / add-if-absent / replace.
 */
export const jsonRecordAdapter = {
    id: JSON_RECORD_ADAPTER_ID,
    supports(file) {
        return file.filePath.replace(/\\/g, '/').toLowerCase().endsWith('.json');
    },
    parse(file) {
        return { filePath: file.filePath, value: JSON.parse(file.content) };
    },
    normalize(request) {
        return {
            requestId: request.requestId,
            actorId: request.actorId,
            filePath: request.filePath,
            op: request.op,
            target: normalizePointer(request.target),
            value: request.value
        };
    },
    getConflictKeys(mutation, _parsed) {
        return [jsonPointerConflictKey(mutation.filePath, mutation.target)];
    },
    canMerge(mutations, _parsed) {
        const keys = new Map();
        const collisions = [];
        for (const mutation of mutations) {
            const key = jsonPointerConflictKey(mutation.filePath, mutation.target);
            if (keys.has(key.key)) {
                collisions.push(key);
            }
            else {
                keys.set(key.key, key);
            }
        }
        if (collisions.length > 0) {
            return {
                schemaId: 'atm.mergeDecision.v1',
                specVersion: '0.1.0',
                migration: brokerAdapterMigration(),
                verdict: 'conflict',
                reason: 'two or more JSON record mutations target the same pointer; record edits are not commutative',
                conflictKeys: collisions
            };
        }
        return {
            schemaId: 'atm.mergeDecision.v1',
            specVersion: '0.1.0',
            migration: brokerAdapterMigration(),
            verdict: 'mergeable',
            reason: 'all JSON record mutations target distinct pointers',
            conflictKeys: [...keys.values()]
        };
    },
    merge(mutations, parsed) {
        const decision = jsonRecordAdapter.canMerge(mutations, parsed);
        if (decision.verdict === 'conflict') {
            throw new Error(`json-record adapter cannot merge conflicting mutations: ${decision.reason}`);
        }
        let root = parsed.value;
        for (const mutation of mutations) {
            const op = mutation.op;
            const current = getAtPointer(root, mutation.target);
            if (op === 'add-if-absent') {
                if (current.found) {
                    continue;
                }
                root = setAtPointer(root, mutation.target, mutation.value);
            }
            else if (op === 'replace') {
                if (!current.found) {
                    throw new Error(`json-record replace requires an existing pointer: ${mutation.target}`);
                }
                root = setAtPointer(root, mutation.target, mutation.value);
            }
            else if (op === 'upsert') {
                root = setAtPointer(root, mutation.target, mutation.value);
            }
            else {
                throw new Error(`json-record adapter does not support op '${mutation.op}' (supported: ${SUPPORTED_OPS.join(', ')})`);
            }
        }
        return { filePath: parsed.filePath, value: root };
    },
    serialize(parsed) {
        return `${JSON.stringify(parsed.value, null, 2)}\n`;
    },
    validate(file) {
        try {
            JSON.parse(file.content);
            return { ok: true, errors: [] };
        }
        catch (error) {
            return { ok: false, errors: [`invalid JSON: ${error instanceof Error ? error.message : String(error)}`] };
        }
    }
};
