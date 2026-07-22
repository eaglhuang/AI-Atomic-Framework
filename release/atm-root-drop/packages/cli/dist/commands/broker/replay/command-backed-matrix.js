import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
export function inspectCommandBackedMatrix(cwd) {
    const relativeCellsPath = 'artifacts/generated/atm-ab-v4/cells.json';
    const cellsPath = path.join(cwd, relativeCellsPath);
    if (!existsSync(cellsPath)) {
        return {
            cellsPath: relativeCellsPath,
            cellCount: 0,
            commandBackedCount: 0,
            missing: true
        };
    }
    const cells = JSON.parse(readFileSync(cellsPath, 'utf8'));
    const cellArray = Array.isArray(cells) ? cells : [];
    const commandBackedCount = cellArray.filter(hasCommandBackedCellEvidence).length;
    return {
        cellsPath: relativeCellsPath,
        cellCount: cellArray.length,
        commandBackedCount,
        missing: false
    };
}
export function hasCommandBackedCellEvidence(cell) {
    if (!cell || typeof cell !== 'object')
        return false;
    const record = cell;
    return hasValidReceiptArray(record.commandReceipts) || hasValidReceiptArray(record.workloadReceipts);
}
function hasValidReceiptArray(value) {
    if (!Array.isArray(value))
        return false;
    return value.some(isValidCommandOrWorkloadReceipt);
}
function isValidCommandOrWorkloadReceipt(value) {
    if (!value || typeof value !== 'object')
        return false;
    const receipt = value;
    const command = typeof receipt.command === 'string' ? receipt.command.trim() : '';
    const exitCode = Number(receipt.exitCode);
    const startedAtMs = Number(receipt.startedAtMs);
    const finishedAtMs = Number(receipt.finishedAtMs);
    const durationMs = Number(receipt.durationMs);
    const hasTiming = (Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs) && finishedAtMs >= startedAtMs)
        || (Number.isFinite(durationMs) && durationMs >= 0);
    const stdoutDigest = typeof receipt.stdoutDigest === 'string' ? receipt.stdoutDigest : typeof receipt.stdoutSha256 === 'string' ? receipt.stdoutSha256 : '';
    const stderrDigest = typeof receipt.stderrDigest === 'string' ? receipt.stderrDigest : typeof receipt.stderrSha256 === 'string' ? receipt.stderrSha256 : '';
    // Generic closure rule: a replay cell is command-backed only when it carries a real
    // executable receipt shape. A digest-only shortcut is intentionally not enough.
    return command.length > 0
        && Number.isInteger(exitCode)
        && exitCode === 0
        && hasTiming
        && isSha256Digest(stdoutDigest)
        && isSha256Digest(stderrDigest);
}
function isSha256Digest(value) {
    return /^sha256:[a-f0-9]{64}$/i.test(value.trim());
}
