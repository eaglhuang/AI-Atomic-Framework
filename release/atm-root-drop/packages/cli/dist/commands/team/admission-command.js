import { runTeam as runLegacyTeam } from '../team-legacy.js';
export async function runTeamAdmissionCommand(argv) {
    const subcommand = String(argv[0] ?? '').toLowerCase();
    if (subcommand === 'validate')
        return runLegacyTeam(argv);
    return runLegacyTeam(['validate', ...argv.slice(1)]);
}
