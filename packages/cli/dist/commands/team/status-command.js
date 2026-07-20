import { runTeam as runLegacyTeam } from '../team-legacy.js';
export async function runTeamStatusCommand(argv) {
    return runLegacyTeam(argv);
}
