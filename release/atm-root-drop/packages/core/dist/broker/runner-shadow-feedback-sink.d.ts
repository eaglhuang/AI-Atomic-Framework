export interface RunnerShadowFeedbackObservation {
    readonly observedAt: string;
    readonly kind: string;
    readonly taskId?: string;
    readonly runnerReceiptDigest?: string;
    readonly details?: Readonly<Record<string, unknown>>;
}
export interface RunnerShadowFeedbackSink {
    append(observation: RunnerShadowFeedbackObservation): void;
    readAll(): readonly RunnerShadowFeedbackObservation[];
}
export declare class InMemoryRunnerShadowFeedbackSink implements RunnerShadowFeedbackSink {
    #private;
    append(observation: RunnerShadowFeedbackObservation): void;
    readAll(): readonly RunnerShadowFeedbackObservation[];
}
