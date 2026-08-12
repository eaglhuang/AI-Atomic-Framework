import { runTeam as runLegacyTeam } from '../team-legacy.ts';
export type TeamCommandHandler = typeof runLegacyTeam;
export type TeamCommandRegistration = {
    readonly subcommand: string;
    readonly atomId: string;
    readonly handler: TeamCommandHandler;
};
export declare const teamCommandRegistry: readonly TeamCommandRegistration[];
export declare function resolveTeamCommandHandler(argv: string[]): TeamCommandHandler;
export declare function runTeam(argv: string[]): ReturnType<typeof runLegacyTeam>;
