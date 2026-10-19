/**
 * Paste contract for commands ATM tells an operator to run.
 *
 * A command is runnable only when every slot is filled. Angle brackets are
 * shell redirects, so a missing slot is published as a shell-safe token
 * (ATM_ACTOR_ID, never `<id>`) plus `missing` and `pasteReady: false`.
 * Tokens we emit stay unresolved even after the brackets are gone, so a later
 * copy of the same string is still not labelled ready.
 */
const PLACEHOLDER_CATALOG = [
    { test: /^(id|actor|actor-id|actorid)$/i, token: 'ATM_ACTOR_ID', flag: '--actor' },
    { test: /queue-head|task-id|task id|^task$|blocking-task/i, token: 'ATM_TASK_ID', flag: '--task' },
    { test: /prompt|description/i, token: 'ATM_USER_PROMPT', flag: '--prompt' },
    { test: /^command$/i, token: 'ATM_COMMAND', flag: '--command' },
    { test: /^(message|summary|scope)$/i, token: 'ATM_COMMIT_MESSAGE', flag: '--message' },
    { test: /what passed/i, token: 'ATM_EVIDENCE_SUMMARY', flag: '--summary' },
    { test: /real-files|deliverable|staged-files|^path$|paths/i, token: 'ATM_PATHS', flag: '--artifacts' },
    { test: /validator/i, token: 'ATM_VALIDATOR', flag: '--validators' },
    { test: /^hash$/i, token: 'ATM_SHA256', flag: '--stdout-sha256' },
    { test: /sha|historical/i, token: 'ATM_COMMIT_SHA', flag: '--delivery-commit' },
    { test: /editor/i, token: 'ATM_EDITOR_ID', flag: '--editor' },
    { test: /plan\.md|source-task/i, token: 'ATM_PLAN_PATH', flag: '--from' },
    { test: /git user\.name/i, token: 'ATM_GIT_NAME', flag: '--git-name' },
    { test: /git user\.email/i, token: 'ATM_GIT_EMAIL', flag: '--git-email' }
];
const TOKEN_FLAGS = new Map(PLACEHOLDER_CATALOG.map((entry) => [entry.token, entry.flag]));
const COMMAND_KEYS = new Set([
    'command', 'requiredCommand', 'nextStep', 'nextCommand', 'normalClaimCommand', 'taskScopedClaimCommand',
    'preferredCommand', 'checkpointCommand', 'repairCommand', 'batchCheckpointCommand', 'preCloseCommand',
    'dryRunCommand', 'writeCommand', 'installCommand', 'fastClaimCommand'
]);
const GAP_ARRAY_KEYS = new Set(['commandSequence', 'allowedCommands']);
const PROSE_KEYS = new Set(['batchInstruction']);
const PROSE_ARRAY_KEYS = new Set(['steps']);
const SKIP_KEYS = new Set([
    'importedTaskQueue', 'selectedTask', 'selectedTasks', 'taskIntent', 'taskDocument', 'tasks',
    'integrationBootstrap', 'runtimeAdapterReadiness', 'frameworkStatus', 'runnerMode', 'candidates', 'decisionTrail'
]);
function knownPlaceholder(inner) {
    const known = PLACEHOLDER_CATALOG.find((entry) => entry.test.test(inner.trim()));
    return known ? { token: known.token, flag: known.flag } : null;
}
export function mapPlaceholder(inner) {
    const known = knownPlaceholder(inner);
    const mapped = known ?? (() => {
        const slug = inner.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || 'VALUE';
        return { token: `ATM_${slug}`, flag: `--${slug.toLowerCase().replace(/_/g, '-')}` };
    })();
    TOKEN_FLAGS.set(mapped.token, mapped.flag);
    return mapped;
}
export function rewriteAnglePlaceholders(raw) {
    const missing = new Set();
    let out = '';
    for (let index = 0; index < raw.length; index += 1) {
        const char = raw[index];
        if (char === '"' || char === "'") {
            const quote = char;
            let cursor = index + 1;
            let body = '';
            while (cursor < raw.length && raw[cursor] !== quote) {
                if (raw[cursor] === '\\' && cursor + 1 < raw.length) {
                    body += raw[cursor + 1];
                    cursor += 2;
                    continue;
                }
                body += raw[cursor];
                cursor += 1;
            }
            const closed = cursor < raw.length;
            if (closed) {
                const whole = /^<([^>\r\n]+)>$/.exec(body);
                let nextBody = body;
                let changed = false;
                if (whole) {
                    const mapped = mapPlaceholder(whole[1]);
                    missing.add(mapped.flag);
                    nextBody = mapped.token;
                    changed = true;
                }
                else {
                    nextBody = body.replace(/<([^>\r\n]+)>/g, (match, inner) => {
                        const known = knownPlaceholder(inner);
                        if (!known)
                            return match;
                        missing.add(known.flag);
                        TOKEN_FLAGS.set(known.token, known.flag);
                        changed = true;
                        return known.token;
                    });
                }
                if (changed) {
                    const escaped = quote === "'" ? nextBody.replace(/'/g, `'\\''`) : nextBody.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                    out += `${quote}${escaped}${quote}`;
                    index = cursor;
                    continue;
                }
            }
            out += raw.slice(index, closed ? cursor + 1 : raw.length);
            index = closed ? cursor : raw.length - 1;
            continue;
        }
        if (char === '<') {
            const end = raw.indexOf('>', index + 1);
            const inner = end === -1 ? '' : raw.slice(index + 1, end);
            if (end !== -1 && !inner.includes('\n') && !inner.includes('<')) {
                const mapped = mapPlaceholder(inner);
                missing.add(mapped.flag);
                out += mapped.token;
                index = end;
                continue;
            }
        }
        out += char;
    }
    return { text: out, missing: [...missing].sort() };
}
function shellWords(command) {
    const words = [];
    let current = '';
    let quote = null;
    for (let index = 0; index < command.length; index += 1) {
        const char = command[index];
        if (quote) {
            if (char === quote)
                quote = null;
            else if (char === '\\' && quote === '"' && index + 1 < command.length)
                current += command[++index];
            else
                current += char;
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (/\s/.test(char)) {
            if (current)
                words.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    if (current)
        words.push(current);
    return words;
}
function unresolvedFlags(command) {
    const flags = new Set();
    for (const word of shellWords(command)) {
        const flag = TOKEN_FLAGS.get(word);
        if (flag)
            flags.add(flag);
    }
    return [...flags];
}
export function sealPasteCommand(raw) {
    const rewritten = rewriteAnglePlaceholders(raw);
    const missing = new Set([...rewritten.missing, ...unresolvedFlags(rewritten.text)]);
    if (missing.size === 0)
        return { ready: true, command: rewritten.text, missing: [] };
    return { ready: false, commandTemplate: rewritten.text, missing: [...missing].sort() };
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function mergeMissing(existing, extra) {
    const merged = new Set([
        ...(Array.isArray(existing) ? existing.filter((entry) => typeof entry === 'string') : []),
        ...extra
    ]);
    return [...merged].sort();
}
function sealStringField(record, key, value) {
    if (PROSE_KEYS.has(key)) {
        record[key] = rewriteAnglePlaceholders(value).text;
        return;
    }
    if (!COMMAND_KEYS.has(key))
        return;
    const sealed = sealPasteCommand(value);
    if (sealed.ready) {
        if (sealed.command !== value)
            record[key] = sealed.command;
        return;
    }
    record[key] = sealed.commandTemplate;
    record.missing = mergeMissing(record.missing, sealed.missing);
    if (key === 'command') {
        record.commandTemplate = sealed.commandTemplate;
        record.pasteReady = false;
        return;
    }
    record[`${key}Ready`] = false;
    if (typeof record.command !== 'string') {
        record.commandTemplate = sealed.commandTemplate;
        record.pasteReady = false;
    }
}
function sealGapArray(record, key, list) {
    const gapKey = key === 'allowedCommands' ? 'unresolvedAllowedCommands' : 'unresolvedCommands';
    const gaps = Array.isArray(record[gapKey])
        ? [...record[gapKey]]
        : [];
    const seen = new Set(gaps.map((gap) => gap.index));
    list.forEach((entry, index) => {
        if (typeof entry !== 'string' || seen.has(index))
            return;
        const sealed = sealPasteCommand(entry);
        if (sealed.ready) {
            if (sealed.command !== entry)
                list[index] = sealed.command;
            return;
        }
        list[index] = sealed.commandTemplate;
        gaps.push({ index, missing: sealed.missing });
        seen.add(index);
    });
    if (gaps.length === 0)
        return;
    record[gapKey] = gaps;
    if (key === 'commandSequence')
        record.missing = mergeMissing(record.missing, gaps.flatMap((gap) => [...gap.missing]));
}
export function sealCommandTree(value) {
    walk(value);
    return value;
}
function walk(value) {
    if (Array.isArray(value)) {
        for (const entry of value)
            walk(entry);
        return;
    }
    if (!isRecord(value))
        return;
    for (const [key, child] of Object.entries(value)) {
        if (SKIP_KEYS.has(key))
            continue;
        if (typeof child === 'string')
            sealStringField(value, key, child);
        else if (Array.isArray(child) && (GAP_ARRAY_KEYS.has(key) || PROSE_ARRAY_KEYS.has(key))) {
            if (PROSE_ARRAY_KEYS.has(key)) {
                child.forEach((entry, index) => {
                    if (typeof entry === 'string')
                        child[index] = rewriteAnglePlaceholders(entry).text;
                    else
                        walk(entry);
                });
            }
            else {
                sealGapArray(value, key, child);
                for (const entry of child)
                    walk(entry);
            }
        }
        else {
            walk(child);
        }
    }
}
export function sealPublishedCommands(result) {
    const evidence = isRecord(result.evidence) ? result.evidence : null;
    if (evidence && isRecord(evidence.nextAction))
        sealCommandTree(evidence.nextAction);
    if (Array.isArray(result.messages)) {
        for (const entry of result.messages) {
            if (isRecord(entry) && isRecord(entry.data))
                sealCommandTree(entry.data);
        }
    }
    if (!evidence)
        return;
    for (const key of ['findings', 'failureEnvelope', 'hookFindings', 'preCommit', 'requiredCommand']) {
        if (key in evidence)
            sealCommandTree(evidence[key]);
    }
}
