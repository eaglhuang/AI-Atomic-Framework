export declare const telemetryConfigRelativePath: string;
export type TelemetryResult = 'success' | 'fail';
export interface TelemetryState {
    readonly schemaVersion: 'atm.telemetry.v0.1';
    readonly enabled: boolean;
    readonly endpoint: string | null;
    readonly updatedAt: string;
    readonly allowedFields: readonly string[];
}
export interface TelemetryPayload {
    readonly schemaVersion: 'atm.telemetryPayload.v0.1';
    readonly cliVersion: string;
    readonly nodeVersion: string;
    readonly osFamily: string;
    readonly chartStatus: string;
    readonly commandName: string;
    readonly result: TelemetryResult;
}
export type TelemetrySender = (payload: TelemetryPayload, state: TelemetryState) => Promise<void> | void;
export declare const telemetryAllowedFields: readonly string[];
export declare function defaultTelemetryState(now?: string): TelemetryState;
export declare function readTelemetryState(cwd: string): TelemetryState;
export declare function writeTelemetryState(cwd: string, state: TelemetryState): TelemetryState;
export declare function setTelemetryEnabled(cwd: string, enabled: boolean, endpoint?: string | null, now?: string): TelemetryState;
export declare function createTelemetryPayload(input: {
    readonly cliVersion?: string;
    readonly chartStatus?: string;
    readonly commandName: string;
    readonly result: TelemetryResult;
}): TelemetryPayload;
export declare function recordTelemetryEvent(cwd: string, payload: TelemetryPayload, sender: TelemetrySender): Promise<{
    sent: boolean;
    reason: string;
    payload: TelemetryPayload | null;
}>;
