import { brokerAdapterMigration } from '../types.js';
export const NUMERIC_SCALAR_ADAPTER_ID = 'numeric-scalar';
const COMMUTATIVE_ADDITIVE = new Set(['increment', 'decrement']);
const COMMUTATIVE_EXTREME = new Set(['max', 'min']);
function scalarConflictKey(filePath, scalarKey) {
    return {
        schemaId: 'atm.conflictKey.v1',
        specVersion: '0.1.0',
        migration: brokerAdapterMigration(),
        scope: 'scalar',
        key: `scalar:${filePath}::${scalarKey}`
    };
}
function numericValue(value) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) {
        throw new Error(`numeric-scalar adapter requires a finite numeric value, got: ${String(value)}`);
    }
    return n;
}
function parsedValues(parsed) {
    return parsed.value.values;
}
/**
 * Numeric scalar adapter (TASK-CID-0096). Files hold a flat map of
 * scalarKey -> number. increment/decrement are commutative (net delta applied);
 * max/min are commutative among themselves; set-if-current is NOT commutative
 * and conflicts with anything else on the same scalar. Scope is 'scalar'.
 */
export const numericScalarAdapter = {
    id: NUMERIC_SCALAR_ADAPTER_ID,
    supports(file) {
        const normalized = file.filePath.replace(/\\/g, '/').toLowerCase();
        return normalized.endsWith('.scalars.json') || normalized.endsWith('.counter.json');
    },
    parse(file) {
        const raw = JSON.parse(file.content);
        const values = {};
        for (const [key, value] of Object.entries(raw)) {
            values[key] = numericValue(value);
        }
        return { filePath: file.filePath, value: { values } };
    },
    normalize(request) {
        return {
            requestId: request.requestId,
            actorId: request.actorId,
            filePath: request.filePath,
            op: request.op,
            target: request.target,
            value: request.value
        };
    },
    getConflictKeys(mutation, _parsed) {
        return [scalarConflictKey(mutation.filePath, mutation.target)];
    },
    canMerge(mutations, _parsed) {
        const byScalar = new Map();
        for (const mutation of mutations) {
            const key = scalarConflictKey(mutation.filePath, mutation.target).key;
            const bucket = byScalar.get(key);
            if (bucket) {
                bucket.push(mutation);
            }
            else {
                byScalar.set(key, [mutation]);
            }
        }
        const conflictKeys = [];
        let sawCommutativeGroup = false;
        for (const bucket of byScalar.values()) {
            if (bucket.length <= 1) {
                continue;
            }
            const ops = new Set(bucket.map((mutation) => mutation.op));
            const allAdditive = [...ops].every((op) => COMMUTATIVE_ADDITIVE.has(op));
            const allExtreme = [...ops].every((op) => COMMUTATIVE_EXTREME.has(op));
            if (allAdditive || allExtreme) {
                sawCommutativeGroup = true;
            }
            else {
                conflictKeys.push(scalarConflictKey(bucket[0].filePath, bucket[0].target));
            }
        }
        if (conflictKeys.length > 0) {
            return {
                schemaId: 'atm.mergeDecision.v1',
                specVersion: '0.1.0',
                migration: brokerAdapterMigration(),
                verdict: 'conflict',
                reason: 'mutations on the same scalar mix non-commutative operations (e.g. set-if-current with another op)',
                conflictKeys
            };
        }
        const allKeys = [...byScalar.values()].map((bucket) => scalarConflictKey(bucket[0].filePath, bucket[0].target));
        if (sawCommutativeGroup) {
            return {
                schemaId: 'atm.mergeDecision.v1',
                specVersion: '0.1.0',
                migration: brokerAdapterMigration(),
                verdict: 'commutative-merge',
                reason: 'concurrent mutations on a scalar are commutative (increment/decrement net delta, or max/min)',
                conflictKeys: allKeys
            };
        }
        return {
            schemaId: 'atm.mergeDecision.v1',
            specVersion: '0.1.0',
            migration: brokerAdapterMigration(),
            verdict: 'mergeable',
            reason: 'all scalar mutations target distinct scalars',
            conflictKeys: allKeys
        };
    },
    merge(mutations, parsed) {
        const decision = numericScalarAdapter.canMerge(mutations, parsed);
        if (decision.verdict === 'conflict') {
            throw new Error(`numeric-scalar adapter cannot merge conflicting mutations: ${decision.reason}`);
        }
        const values = { ...parsedValues(parsed) };
        for (const mutation of mutations) {
            const op = mutation.op;
            const current = values[mutation.target] ?? 0;
            if (op === 'increment') {
                values[mutation.target] = current + numericValue(mutation.value);
            }
            else if (op === 'decrement') {
                values[mutation.target] = current - numericValue(mutation.value);
            }
            else if (op === 'max') {
                values[mutation.target] = Math.max(current, numericValue(mutation.value));
            }
            else if (op === 'min') {
                values[mutation.target] = Math.min(current, numericValue(mutation.value));
            }
            else if (op === 'set-if-current') {
                const payload = mutation.value;
                const expected = numericValue(payload?.expected);
                if (current !== expected) {
                    throw new Error(`numeric-scalar set-if-current expected ${expected} but found ${current} for ${mutation.target}`);
                }
                values[mutation.target] = numericValue(payload?.next);
            }
            else {
                throw new Error(`numeric-scalar adapter does not support op '${mutation.op}'`);
            }
        }
        return { filePath: parsed.filePath, value: { values } };
    },
    serialize(parsed) {
        const values = parsedValues(parsed);
        const sorted = Object.fromEntries(Object.keys(values).sort().map((key) => [key, values[key]]));
        return `${JSON.stringify(sorted, null, 2)}\n`;
    }
};
