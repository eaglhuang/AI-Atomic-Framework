import { type ReplayDashboardInput, type ReplayDashboardRunManifest } from '../../../../../core/src/broker/replay/dashboard.ts';
export interface ReplayDashboardViewModelOptions {
    readonly cwd: string;
    readonly surfaces: readonly string[];
    readonly actorId?: string | null;
    readonly taskId?: string | null;
}
export declare function buildReplayDashboardViewModel(options: ReplayDashboardViewModelOptions): {
    snapshot: import("packages/core/src/broker/replay/index.ts").ReplayDashboardSnapshot;
    ticketObservations: import("./dashboard-ticket-observations.ts").ReplayDashboardTicketObservationSummary;
    lifecycleObservations: import("./dashboard-lifecycle-observations.ts").ReplayDashboardLifecycleObservationSummary;
    human: null;
};
export declare function buildReplayRunManifestViewModel(options: ReplayDashboardViewModelOptions): ReplayDashboardRunManifest;
export declare function buildReplayDashboardInput(options: ReplayDashboardViewModelOptions): ReplayDashboardInput;
