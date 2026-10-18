import { brokerAdapterMigration } from '../types.js';
export const TEXT_RANGE_ADAPTER_ID = 'text-range';
function parsedLines(parsed) {
    return parsed.value.lines;
}
/**
 * Resolves the inclusive [start, end] line window a mutation touches.
 * `append` resolves to a single sentinel EOF range so two concurrent appends
 * collide conservatively. `insertAfterHeading` resolves to the heading line.
 * `replaceRange` parses a "start:end" (1-based) target.
 */
function resolveRange(mutation, lines) {
    const op = mutation.op;
    if (op === 'append') {
        const eof = lines.length + 1;
        return { start: eof, end: eof };
    }
    if (op === 'insertAfterHeading') {
        const index = lines.findIndex((line) => line.trim() === mutation.target.trim());
        if (index < 0) {
            throw new Error(`text-range insertAfterHeading could not find heading: ${mutation.target}`);
        }
        const lineNo = index + 1;
        return { start: lineNo, end: lineNo };
    }
    if (op === 'replaceRange') {
        const [rawStart, rawEnd] = mutation.target.split(':');
        const start = Number.parseInt(rawStart, 10);
        const end = Number.parseInt(rawEnd ?? rawStart, 10);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
            throw new Error(`text-range replaceRange requires a 'start:end' (1-based) target, got: ${mutation.target}`);
        }
        return { start, end };
    }
    throw new Error(`text-range adapter does not support op '${mutation.op}'`);
}
function rangeConflictKey(filePath, range) {
    return {
        schemaId: 'atm.conflictKey.v1',
        specVersion: '0.1.0',
        migration: brokerAdapterMigration(),
        scope: range.start === range.end ? 'line' : 'range',
        key: `range:${filePath}::${range.start}-${range.end}`
    };
}
function overlaps(a, b) {
    return a.start <= b.end && b.start <= a.end;
}
function valueLines(value) {
    if (value === undefined || value === null) {
        return [];
    }
    return String(value).split('\n');
}
/**
 * Text range adapter (TASK-CID-0095). Operates on line ranges of a text file.
 * Non-overlapping ranges are mergeable; overlapping ranges conflict. Concurrent
 * appends are treated conservatively as overlapping (same EOF range) and thus
 * conflict, per the plan's "overlapping ranges default to conflict" rule.
 * Supports append / insertAfterHeading / replaceRange.
 */
export const textRangeAdapter = {
    id: TEXT_RANGE_ADAPTER_ID,
    supports(file) {
        const normalized = file.filePath.replace(/\\/g, '/').toLowerCase();
        return normalized.endsWith('.md') || normalized.endsWith('.txt');
    },
    parse(file) {
        return { filePath: file.filePath, value: { lines: file.content.split('\n') } };
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
    getConflictKeys(mutation, parsed) {
        return [rangeConflictKey(mutation.filePath, resolveRange(mutation, parsedLines(parsed)))];
    },
    canMerge(mutations, parsed) {
        const lines = parsedLines(parsed);
        const resolved = mutations.map((mutation) => ({ mutation, range: resolveRange(mutation, lines) }));
        const conflictKeys = [];
        for (let i = 0; i < resolved.length; i += 1) {
            for (let j = i + 1; j < resolved.length; j += 1) {
                if (overlaps(resolved[i].range, resolved[j].range)) {
                    conflictKeys.push(rangeConflictKey(parsed.filePath, resolved[i].range));
                    conflictKeys.push(rangeConflictKey(parsed.filePath, resolved[j].range));
                }
            }
        }
        if (conflictKeys.length > 0) {
            return {
                schemaId: 'atm.mergeDecision.v1',
                specVersion: '0.1.0',
                migration: brokerAdapterMigration(),
                verdict: 'conflict',
                reason: 'two or more text mutations target overlapping line ranges',
                conflictKeys
            };
        }
        return {
            schemaId: 'atm.mergeDecision.v1',
            specVersion: '0.1.0',
            migration: brokerAdapterMigration(),
            verdict: 'mergeable',
            reason: 'all text mutations target disjoint line ranges',
            conflictKeys: resolved.map((entry) => rangeConflictKey(parsed.filePath, entry.range))
        };
    },
    merge(mutations, parsed) {
        const decision = textRangeAdapter.canMerge(mutations, parsed);
        if (decision.verdict === 'conflict') {
            throw new Error(`text-range adapter cannot merge conflicting mutations: ${decision.reason}`);
        }
        // Apply highest-line-first so earlier indices stay stable across edits.
        const lines = [...parsedLines(parsed)];
        const ordered = mutations
            .map((mutation) => ({ mutation, range: resolveRange(mutation, parsedLines(parsed)) }))
            .sort((a, b) => b.range.start - a.range.start);
        for (const { mutation, range } of ordered) {
            const op = mutation.op;
            const inserts = valueLines(mutation.value);
            if (op === 'append') {
                lines.push(...inserts);
            }
            else if (op === 'insertAfterHeading') {
                lines.splice(range.start, 0, ...inserts);
            }
            else if (op === 'replaceRange') {
                lines.splice(range.start - 1, range.end - range.start + 1, ...inserts);
            }
        }
        return { filePath: parsed.filePath, value: { lines } };
    },
    serialize(parsed) {
        return parsedLines(parsed).join('\n');
    }
};
