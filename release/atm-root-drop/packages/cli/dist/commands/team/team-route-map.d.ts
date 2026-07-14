export type TeamCommandFastPath = 'handoff' | 'knowledge' | 'broker' | 'observability';
export type TeamParsedAction = 'plan' | 'start' | 'status' | 'validate' | 'patrol' | 'lease' | 'release' | 'complete' | 'abandon' | 'wave' | 'knowledge' | 'broker' | 'observability';
export type TeamRouteKind = 'fast-path' | 'special-action' | 'status' | 'lifecycle' | 'patrol' | 'planning';
export type TeamRouteResolution = {
    kind: 'fast-path';
    fastPath: TeamCommandFastPath;
    argv: string[];
    cwdSource: 'option-or-process' | 'process';
} | {
    kind: 'special-action';
    action: Extract<TeamParsedAction, 'wave' | 'knowledge' | 'broker' | 'observability'>;
    argv: string[];
} | {
    kind: 'status';
    action: 'status';
} | {
    kind: 'lifecycle';
    action: Extract<TeamParsedAction, 'lease' | 'release' | 'complete' | 'abandon'>;
} | {
    kind: 'patrol';
    action: 'patrol';
} | {
    kind: 'planning';
    action: Extract<TeamParsedAction, 'plan' | 'start' | 'validate'>;
};
export declare function isSupportedTeamAction(action: string): action is TeamParsedAction;
export declare function resolveTeamFastPath(argv: readonly string[]): Extract<TeamRouteResolution, {
    kind: 'fast-path';
}> | null;
export declare function resolveTeamActionRoute(actionValue: unknown, positionalTail: readonly unknown[]): TeamRouteResolution;
export declare function supportedTeamActionList(): string;
