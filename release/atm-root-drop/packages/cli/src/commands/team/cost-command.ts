import { runTeam as runLegacyTeam } from '../team-legacy.ts';

export async function runTeamCostCommand(argv: string[]) {
  const result = await runLegacyTeam(['plan', ...argv.slice(1), '--read-only']);
  const evidence = (result.evidence ?? {}) as Record<string, unknown>;
  const teamPlan = evidence.teamPlan && typeof evidence.teamPlan === 'object'
    ? evidence.teamPlan as Record<string, unknown>
    : null;
  const validation = evidence.validation && typeof evidence.validation === 'object'
    ? evidence.validation as Record<string, unknown>
    : null;
  return {
    ...result,
    ok: true,
    command: 'team cost',
    evidence: {
      ...evidence,
      action: 'cost',
      costProjection: teamPlan?.costProjection ?? null,
      admissionOk: result.ok,
      admissionFindings: validation?.findings ?? [],
      note: 'Cost governance is projected from the read-only team plan until a dedicated cost model is promoted.'
    },
    severity: 'success',
    exitCode: 0,
    blocking: false
  };
}
