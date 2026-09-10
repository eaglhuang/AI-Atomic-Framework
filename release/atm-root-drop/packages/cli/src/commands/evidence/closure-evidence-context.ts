import { readFrameworkVersion, relativePathFrom } from '../shared.ts';
import { readEvidenceBundle } from './evidence-store.ts';

type EvidenceRecord = Record<string, unknown>;

function recordsForTask(cwd: string, taskId: string): EvidenceRecord[] {
  const bundle = readEvidenceBundle(cwd, taskId) as { evidence?: unknown };
  return Array.isArray(bundle.evidence)
    ? bundle.evidence.filter((entry): entry is EvidenceRecord => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    : [];
}

export function closureEvidenceContextForTask(cwd: string, taskId: string) {
  const records = recordsForTask(cwd, taskId);
  const commandRuns = records.flatMap((record) => {
    const details = record.details && typeof record.details === 'object' && !Array.isArray(record.details)
      ? record.details as EvidenceRecord
      : null;
    const candidates = [record.commandRuns, details?.commandRuns].flatMap((value) => Array.isArray(value) ? value : []);
    return candidates.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
      const run = candidate as EvidenceRecord;
      if (typeof run.command !== 'string' || typeof run.exitCode !== 'number') return [];
      if (!/^sha256:[a-f0-9]{64}$/i.test(String(run.stdoutSha256 ?? ''))) return [];
      if (!/^sha256:[a-f0-9]{64}$/i.test(String(run.stderrSha256 ?? ''))) return [];
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
      ? record.details as EvidenceRecord
      : null;
    return [record.validationPasses, details?.validationPasses]
      .flatMap((value) => Array.isArray(value) ? value : [])
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
      .map((value) => value.trim());
  }))].sort();
  const evidenceFreshness = records.some((record) => record.evidenceFreshness === 'fresh' || record.freshness === 'fresh')
    ? 'fresh' as const
    : records.some((record) => record.evidenceFreshness === 'historical-reference' || record.freshness === 'historical-reference')
      ? 'historical-reference' as const
      : 'draft' as const;
  return { commandRuns, validationPasses, evidenceFreshness };
}
