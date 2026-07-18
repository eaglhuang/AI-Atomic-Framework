export declare const historyLaneSessionEventsRootRelativePath: ".atm/history/session-events";
export interface LaneSessionEvent {
    readonly schemaId: 'atm.laneSessionEvent.v1';
    readonly specVersion: '0.1.0';
    readonly eventId: string;
    readonly laneId: string;
    readonly sequence: number;
    readonly action: string;
    readonly actorId: string | null;
    readonly createdAt: string;
    readonly details: Record<string, unknown>;
}
export interface AppendLaneSessionEventInput {
    readonly cwd: string;
    readonly laneId: string;
    readonly action: string;
    readonly actorId?: string | null;
    readonly createdAt?: string;
    readonly details?: Record<string, unknown>;
}
export declare function appendLaneSessionEvent(input: AppendLaneSessionEventInput): {
    readonly event: LaneSessionEvent;
    readonly eventPath: string;
};
export declare function listLaneSessionEvents(cwd: string, laneId: string): readonly LaneSessionEvent[];
export declare function laneSessionEventDirectory(cwd: string, laneId: string): string;
export declare function laneSessionEventPathFor(cwd: string, laneId: string, eventId: string): string;
