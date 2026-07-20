import { type CommandResult } from '../shared.ts';
export interface DeliverAndCloseDependencies {
    readonly runTasks: (argv: string[]) => Promise<CommandResult>;
}
export declare function runTasksDeliverAndClose(argv: string[], dependencies: DeliverAndCloseDependencies): Promise<CommandResult>;
