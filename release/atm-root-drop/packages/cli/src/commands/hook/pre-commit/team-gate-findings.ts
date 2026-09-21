import { evaluateTeamPreCommitGate } from '../../team-runtime-gates.ts';
import type { PreCommitBlockingFinding } from './support.ts';

/** Adapts team runtime policy into the pre-commit failure envelope. */
export function buildTeamGateFindings(cwd: string, stagedFiles: readonly string[]): PreCommitBlockingFinding[] {
  return evaluateTeamPreCommitGate({
    cwd,
    actorId: process.env.ATM_COMMIT_ACTOR_ID ?? process.env.ATM_ACTOR_ID ?? null,
    stagedFiles
  }).map((finding) => ({
    code: finding.code,
    source: 'team-runtime-gate',
    detail: finding.detail,
    files: finding.files,
    requiredCommand: finding.requiredCommand,
    classification: 'current-task',
    blockerKind: 'governance-state',
    scope: 'staged',
    data: finding
  }));
}
