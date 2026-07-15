import { runTeam as runLegacyTeam } from '../team-legacy.ts';

export async function runTeamAdmissionCommand(argv: string[]) {
  const subcommand = String(argv[0] ?? '').toLowerCase();
  if (subcommand === 'validate') return runLegacyTeam(argv);
  return runLegacyTeam(['validate', ...argv.slice(1)]);
}
