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

export class InMemoryRunnerShadowFeedbackSink implements RunnerShadowFeedbackSink {
  #observations: RunnerShadowFeedbackObservation[] = [];

  append(observation: RunnerShadowFeedbackObservation): void {
    this.#observations.push({ ...observation, details: observation.details ? { ...observation.details } : undefined });
  }

  readAll(): readonly RunnerShadowFeedbackObservation[] {
    return this.#observations.map((observation) => ({
      ...observation,
      details: observation.details ? { ...observation.details } : undefined
    }));
  }
}
