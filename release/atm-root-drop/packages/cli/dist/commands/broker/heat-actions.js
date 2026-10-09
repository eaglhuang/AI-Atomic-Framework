import path from 'node:path';
import { CliError, makeResult, message } from '../shared.js';
import { DEFAULT_FILE_HEAT_RELATIVE_PATH, listHottestFiles, loadFileHeatLedger, resetFileHeat, resolveFileHeatFrozen, resolveFileHeatMode, saveFileHeatLedger } from '../../_vendor/core/dist/broker/file-heat.js';
export function handleBrokerHeatActions(options) {
    if (options.action !== 'heat-status' && options.action !== 'heat-reset')
        return null;
    const ledgerPath = path.join(options.cwd, DEFAULT_FILE_HEAT_RELATIVE_PATH);
    const ledger = loadFileHeatLedger(ledgerPath);
    const tracked = Object.keys(ledger.entries).length;
    if (options.action === 'heat-status') {
        return makeResult({
            ok: true,
            command: 'broker',
            cwd: options.cwd,
            messages: [message('info', 'ATM_BROKER_HEAT_STATUS', `Loaded file heat for ${tracked} tracked path(s).`, { tracked })],
            evidence: {
                action: 'heat-status',
                ledgerPath: DEFAULT_FILE_HEAT_RELATIVE_PATH,
                mode: resolveFileHeatMode(),
                frozen: resolveFileHeatFrozen(),
                files: listHottestFiles(ledger, new Date(), tracked)
            }
        });
    }
    if (!options.actorId) {
        throw new CliError('ATM_CLI_USAGE', 'broker heat-reset requires --actor <actor-id>.', { exitCode: 2 });
    }
    const { ledger: nextLedger, removed } = resetFileHeat(ledger, options.surfaces);
    if (removed.length > 0) {
        saveFileHeatLedger(ledgerPath, nextLedger);
    }
    return makeResult({
        ok: true,
        command: 'broker',
        cwd: options.cwd,
        messages: [message('info', 'ATM_BROKER_HEAT_RESET', `Reset file heat for ${removed.length} path(s).`, { removed: removed.length, actorId: options.actorId })],
        evidence: {
            action: 'heat-reset',
            ledgerPath: DEFAULT_FILE_HEAT_RELATIVE_PATH,
            actorId: options.actorId,
            scope: options.surfaces.length > 0 ? 'paths' : 'all',
            removed
        }
    });
}
