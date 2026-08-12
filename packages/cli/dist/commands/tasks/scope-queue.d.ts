export { runTasksRosterUpdate } from './legacy-impl.ts';
export declare const scopeQueueAtomBoundary: {
    readonly owner: "atm.tasks-command.scope-queue";
    readonly commands: readonly ["tasks scope add", "tasks scope repair", "tasks queue status", "tasks queue abandon", "tasks parallel", "tasks lock cleanup", "tasks roster update"];
};
