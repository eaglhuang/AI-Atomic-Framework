/**
 * O_APPEND records are newline terminated. Ignore an incomplete final record;
 * corruption before the last nonblank line requires explicit recovery.
 * Kept dependency free so the prereg kit can use a type-stripped copy.
 */
export function parseLiveWriteJournal(text) {
    const lines = text.split('\n');
    let last = lines.length - 1;
    while (last >= 0 && !lines[last].trim())
        last -= 1;
    const entries = [];
    for (let index = 0; index <= last; index += 1) {
        const line = lines[index];
        if (!line.trim())
            continue;
        if (index === lines.length - 1)
            break; // No terminating newline: not durable.
        try {
            entries.push(JSON.parse(line));
        }
        catch {
            if (index !== last)
                throw new Error(`recovery-required: invalid journal line ${index + 1}`);
        }
    }
    return entries;
}
