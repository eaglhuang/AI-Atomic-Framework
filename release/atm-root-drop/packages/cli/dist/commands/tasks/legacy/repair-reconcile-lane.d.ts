import type { CommandResult } from '../../shared.ts';
export interface LegacyRepairReconcileLane {
    readonly reconcile: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly repairClosure: (argv: string[]) => Promise<CommandResult> | CommandResult;
    readonly repairClaim: (argv: string[]) => Promise<CommandResult> | CommandResult;
}
export declare function createRepairReconcileLane(lane: LegacyRepairReconcileLane): LegacyRepairReconcileLane;
