import { makeResult, message } from '../shared.js';
import { availableAdapters } from './adapters.js';
export function createIntegrationListResult(cwd) {
    const adapters = availableAdapters(cwd);
    return makeResult({
        ok: true,
        command: 'integration',
        cwd,
        messages: [message('info', 'ATM_INTEGRATION_LIST_OK', 'Integration adapters listed.')],
        evidence: {
            adapters,
            available: adapters.map((adapter) => adapter.id),
            installed: adapters.filter((adapter) => adapter.installed).map((adapter) => adapter.id)
        }
    });
}
