import { runTeam as runLegacyTeam } from '../team-legacy.ts';

export async function runTeamStartCommand(argv: string[]) {
  return runLegacyTeam(argv);
}

