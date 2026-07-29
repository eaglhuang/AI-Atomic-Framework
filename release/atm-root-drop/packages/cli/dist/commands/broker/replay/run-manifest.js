import { makeResult, message } from '../../shared.js';
import { buildReplayRunManifestViewModel } from './dashboard-view-model.js';
export function brokerReplayRunManifest(options, requiredIntersection) {
    const manifest = buildReplayRunManifestViewModel({
        cwd: options.cwd,
        surfaces: requiredIntersection,
        actorId: options.actorId,
        taskId: options.task
    });
    return makeResult({
        ok: true,
        command: 'broker',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_BROKER_REPLAY_MANIFEST_SEALED', 'Broker replay run manifest sealed.', {
                runId: manifest.runId,
                digest: manifest.digest
            })
        ],
        evidence: {
            schemaId: 'atm.brokerReplayRunManifestResult.v1',
            action: 'replay-manifest',
            manifest
        }
    });
}
