import { runTeam as runLegacyTeam } from '../team-legacy.js';
export async function runTeamStartCommand(argv) {
    return runLegacyTeam(argv);
}
