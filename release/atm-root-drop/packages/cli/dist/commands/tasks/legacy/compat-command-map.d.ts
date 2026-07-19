import type { CommandResult } from '../../shared.ts';
export type LegacyClaimLifecycleAction = 'claim' | 'renew' | 'release' | 'handoff' | 'takeover';
export interface LegacyTasksCompatCommandHandlers {
    readonly close: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly reset: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly create: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly mirror: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly audit: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly queue: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly parallel: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly lock: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly migrateLegacyLedger: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly claimLifecycle: (action: LegacyClaimLifecycleAction, argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly reconcile: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly repairClosure: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly repairClaim: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly show: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly status: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly finalize: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly deliverAndClose: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly roster: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly newTask: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly importTask: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly verify: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly scope: (argv: string[]) => Promise<CommandResult> | CommandResult;
}
export declare function runTasksCompatCommandMap(argv: string[], handlers: LegacyTasksCompatCommandHandlers): Promise<CommandResult>;
