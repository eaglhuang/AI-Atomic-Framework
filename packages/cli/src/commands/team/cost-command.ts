import { runTeam as runLegacyTeam } from '../team-legacy.ts';

export async function runTeamCostCommand(argv: string[]) {
  const result = await runLegacyTeam(['plan', ...argv.slice(1), '--read-only']);
  const evidence = (result.evidence ?? {}) as Record<string, any>;
  return {
    ...result,
    ok: true,
    command: 'team cost',
    evidence: {
      ...evidence,
      action: 'cost',
      costProjection: evidence.teamPlan?.costProjection ?? null,
      admissionOk: result.ok,
      admissionFindings: evidence.validation?.findings ?? [],
      note: 'Cost governance is projected from the read-only team plan until a dedicated cost model is promoted.'
    },
    severity: 'success',
    exitCode: 0,
    blocking: false
  };
}
