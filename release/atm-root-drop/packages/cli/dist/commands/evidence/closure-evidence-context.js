import { readFrameworkVersion, relativePathFrom } from '../shared.js';
import { readEvidenceBundle } from './evidence-store.js';
function recordsForTask(cwd, taskId) {
    const bundle = readEvidenceBundle(cwd, taskId);
    return Array.isArray(bundle.evidence)
        ? bundle.evidence.filter((entry) => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
        : [];
}
export function closureEvidenceContextForTask(cwd, taskId) {
    const records = recordsForTask(cwd, taskId);
    const commandRuns = records.flatMap((record) => {
        const details = record.details && typeof record.details === 'object' && !Array.isArray(record.details)
            ? record.details
            : null;
        const candidates = [record.commandRuns, details?.commandRuns].flatMap((value) => Array.isArray(value) ? value : []);
        return candidates.flatMap((candidate) => {
            if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
                return [];
            const run = candidate;
            if (typeof run.command !== 'string' || typeof run.exitCode !== 'number')
                return [];
            if (!/^sha256:[a-f0-9]{64}$/i.test(String(run.stdoutSha256 ?? '')))
                return [];
            if (!/^sha256:[a-f0-9]{64}$/i.test(String(run.stderrSha256 ?? '')))
                return [];
            return [{
                    command: run.command,
                    cwd: typeof run.cwd === 'string' && run.cwd.trim() ? run.cwd : (relativePathFrom(cwd, cwd) || '.'),
                    exitCode: run.exitCode,
                    stdoutSha256: String(run.stdoutSha256),
                    stderrSha256: String(run.stderrSha256),
                    runnerVersion: typeof run.runnerVersion === 'string' && run.runnerVersion.trim()
                        ? run.runnerVersion
                        : readFrameworkVersion(cwd)
                }];
        });
    });
    const validationPasses = [...new Set(records.flatMap((record) => {
            const details = record.details && typeof record.details === 'object' && !Array.isArray(record.details)
                ? record.details
                : null;
            return [record.validationPasses, details?.validationPasses]
                .flatMap((value) => Array.isArray(value) ? value : [])
                .filter((value) => typeof value === 'string' && Boolean(value.trim()))
                .map((value) => value.trim());
        }))].sort();
    const evidenceFreshness = records.some((record) => record.evidenceFreshness === 'fresh' || record.freshness === 'fresh')
        ? 'fresh'
        : records.some((record) => record.evidenceFreshness === 'historical-reference' || record.freshness === 'historical-reference')
            ? 'historical-reference'
            : 'draft';
    return { commandRuns, validationPasses, evidenceFreshness };
}
