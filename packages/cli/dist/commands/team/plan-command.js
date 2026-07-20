import { runTeam as runLegacyTeam } from '../team-legacy.js';
export async function runTeamPlanCommand(argv) {
    return runLegacyTeam(argv);
}
