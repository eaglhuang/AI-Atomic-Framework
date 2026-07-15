import { runTeam as runLegacyTeam } from '../team-legacy.ts';

export async function runTeamExecuteCommand(argv: string[]) {
  const args = argv.slice(1);
  const startArgs = args.includes('--execute') ? ['start', ...args] : ['start', ...args, '--execute'];
  return runLegacyTeam(startArgs);
}
