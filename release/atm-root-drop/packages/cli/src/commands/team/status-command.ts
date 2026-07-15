import { runTeam as runLegacyTeam } from '../team-legacy.ts';

export async function runTeamStatusCommand(argv: string[]) {
  return runLegacyTeam(argv);
}

