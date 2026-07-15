import { runTeam as runLegacyTeam } from '../team-legacy.ts';

export async function runTeamPlanCommand(argv: string[]) {
  return runLegacyTeam(argv);
}

