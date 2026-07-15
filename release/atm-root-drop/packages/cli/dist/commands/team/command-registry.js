import { runTeamAdmissionCommand } from './admission-command.js';
import { runTeamCostCommand } from './cost-command.js';
import { runTeamExecuteCommand } from './execute-command.js';
import { runTeamPlanCommand } from './plan-command.js';
import { runTeamReportCommand } from './report-command.js';
import { runTeamStartCommand } from './start-command.js';
import { runTeamStatusCommand } from './status-command.js';
import { runTeam as runLegacyTeam } from '../team-legacy.js';
export const teamCommandRegistry = Object.freeze([
    { subcommand: 'plan', atomId: 'atm.team-plan-command', handler: runTeamPlanCommand },
    { subcommand: 'start', atomId: 'atm.team-start-command', handler: runTeamStartCommand },
    { subcommand: 'status', atomId: 'atm.team-status-command', handler: runTeamStatusCommand },
    { subcommand: 'execute', atomId: 'atm.team-execute-command', handler: runTeamExecuteCommand },
    { subcommand: 'admission', atomId: 'atm.team-admission-policy-module', handler: runTeamAdmissionCommand },
    { subcommand: 'validate', atomId: 'atm.team-admission-policy-module', handler: runTeamAdmissionCommand },
    { subcommand: 'cost', atomId: 'atm.team-cost-governance-module', handler: runTeamCostCommand },
    { subcommand: 'report', atomId: 'atm.team-report-receipt-module', handler: runTeamReportCommand }
]);
const registryBySubcommand = new Map(teamCommandRegistry.map((entry) => [entry.subcommand, entry.handler]));
export function resolveTeamCommandHandler(argv) {
    const subcommand = String(argv[0] ?? 'plan').toLowerCase();
    return registryBySubcommand.get(subcommand) ?? runLegacyTeam;
}
export function runTeam(argv) {
    return resolveTeamCommandHandler(argv)(argv);
}
