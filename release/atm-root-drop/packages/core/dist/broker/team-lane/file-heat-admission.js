import path from 'node:path';
import { buildFileHeatReceipt, DEFAULT_FILE_HEAT_RELATIVE_PATH, LEGACY_HOT_FILE_BASENAMES, loadFileHeatLedger, recordFileTouch, resolveFileHeatFrozen, resolveFileHeatMode, saveFileHeatLedger } from '../file-heat.js';
export function normalizeTeamTargetFiles(writePaths) {
    return [...new Set(writePaths.map((entry) => entry.replace(/\\/g, '/')).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}
/** Hot files follow the heat receipt when supplied, otherwise the static basename set. */
export function selectTeamHotFiles(targetFiles, fileHeat) {
    const heatHotPaths = fileHeat ? new Set(fileHeat.files.filter((entry) => entry.hot).map((entry) => entry.path)) : null;
    return targetFiles.filter((entry) => heatHotPaths
        ? heatHotPaths.has(entry)
        : LEGACY_HOT_FILE_BASENAMES.has(path.posix.basename(entry)));
}
/** Records this intent's touches (unless read-only or frozen) and returns the heat receipt used for admission. */
export function evaluateTeamFileHeat(input) {
    const mode = input.fileHeatMode ?? resolveFileHeatMode();
    const frozen = input.fileHeatFrozen ?? resolveFileHeatFrozen();
    const now = input.now ?? new Date();
    const ledgerPath = input.fileHeatPath ?? path.join(path.resolve(input.cwd), DEFAULT_FILE_HEAT_RELATIVE_PATH);
    const targetFiles = normalizeTeamTargetFiles(input.writePaths);
    let ledger = loadFileHeatLedger(ledgerPath);
    if (!frozen) {
        for (const filePath of targetFiles) {
            ledger = recordFileTouch(ledger, { path: filePath, actorId: input.actorId, taskId: input.taskId, now });
        }
        if (input.readOnly !== true && targetFiles.length > 0) {
            saveFileHeatLedger(ledgerPath, ledger);
        }
    }
    return buildFileHeatReceipt({ mode, ledger, taskId: input.taskId, paths: targetFiles, now, frozen });
}
