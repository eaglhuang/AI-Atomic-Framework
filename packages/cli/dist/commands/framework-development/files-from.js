import { readFileSync } from 'node:fs';
import { CliError } from '../shared.js';
/** Same token normalization as framework-mode `--files`. */
export function normalizeDeclaredFileToken(value) {
    return String(value).replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
/** Comma-separated `--files` list. Empty tokens are dropped. */
export function declaredFilesFromCommaSeparated(value) {
    return value.split(',').map(normalizeDeclaredFileToken).filter(Boolean);
}
/**
 * Newline-separated path list. Each line is one path token and is normalized
 * the same way as one `--files` CSV field. A comma inside a line stays part
 * of that path; the comma delimiter applies only to `--files`.
 */
export function declaredFilesFromNewlineFile(filePath, flag = '--files-from') {
    let text;
    try {
        text = readFileSync(filePath, 'utf8');
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new CliError('ATM_CLI_USAGE', `could not read ${flag} ${filePath}: ${detail}`, { exitCode: 2 });
    }
    return text.split(/\r?\n/).map(normalizeDeclaredFileToken).filter(Boolean);
}
