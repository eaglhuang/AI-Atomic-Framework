import { runTeamAdmissionCommand } from './admission-command.ts';
import { runTeamCostCommand } from './cost-command.ts';
import { runTeamExecuteCommand } from './execute-command.ts';
import { runTeamPlanCommand } from './plan-command.ts';
import { runTeamReportCommand } from './report-command.ts';
import { runTeamStartCommand } from './start-command.ts';
import { runTeamStatusCommand } from './status-command.ts';
import { runTeam as runLegacyTeam } from '../team-legacy.ts';

export type TeamCommandHandler = typeof runLegacyTeam;

export type TeamCommandRegistration = {
  readonly subcommand: string;
  readonly atomId: string;
  readonly handler: TeamCommandHandler;
};

export const teamCommandRegistry: readonly TeamCommandRegistration[] = Object.freeze([
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

export function resolveTeamCommandHandler(argv: string[]): TeamCommandHandler {
  const subcommand = String(argv[0] ?? 'plan').toLowerCase();
  return registryBySubcommand.get(subcommand) ?? runLegacyTeam;
}

export function runTeam(argv: string[]): ReturnType<typeof runLegacyTeam> {
  return resolveTeamCommandHandler(argv)(argv);
}
