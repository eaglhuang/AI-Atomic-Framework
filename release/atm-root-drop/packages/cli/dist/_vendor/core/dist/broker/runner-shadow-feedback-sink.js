export class InMemoryRunnerShadowFeedbackSink {
    #observations = [];
    append(observation) {
        this.#observations.push({ ...observation, details: observation.details ? { ...observation.details } : undefined });
    }
    readAll() {
        return this.#observations.map((observation) => ({
            ...observation,
            details: observation.details ? { ...observation.details } : undefined
        }));
    }
}
