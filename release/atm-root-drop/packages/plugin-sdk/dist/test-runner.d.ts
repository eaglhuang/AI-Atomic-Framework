export type AtomicHealthGateId = 'immutability' | 'side-effects' | 'consumer-contract';
export type TestRunnerCommandKind = 'test' | 'typecheck' | 'lint' | 'custom';
export type TestRunnerOutcomeStatus = 'passed' | 'failed' | 'skipped' | 'not_applicable';
export interface TestRunnerCommand {
    commandId: string;
    commandKind: TestRunnerCommandKind;
    command: string;
    required?: boolean;
    suite?: string | null;
    summary?: string | null;
}
export interface TestRunnerPluginSupport {
    supported: boolean;
    reason?: string | null;
}
export interface TestRunnerPluginContext {
    repositoryRoot: string;
    specPath: string | null;
    atomId: string;
    normalizedModel: any;
    pluginOptions?: Record<string, unknown>;
}
export interface TestRunnerPluginPlan {
    commands?: TestRunnerCommand[];
    suites?: string[];
    evidenceSummary?: string | null;
}
export interface TestRunnerPlugin {
    pluginId: string;
    displayName?: string;
    supports?(context: TestRunnerPluginContext): boolean | TestRunnerPluginSupport;
    plan(context: TestRunnerPluginContext): Promise<TestRunnerPluginPlan> | TestRunnerPluginPlan;
}
export interface TestRunnerPluginReference {
    pluginId: string;
    module: string;
    options?: Record<string, unknown>;
}
export interface AtomicImmutabilityGateConfig {
    beforePath: string;
    afterPath: string;
    allowMutation?: boolean;
    blocking?: boolean;
}
export interface AtomicSideEffectGateConfig {
    beforeDir: string;
    afterDir: string;
    expectedChanged?: string[];
    forbiddenChanged?: string[];
    blocking?: boolean;
}
export interface AtomicConsumerContractCase {
    name: string;
    actualPath: string;
    expectedPath: string;
    comparator?: 'json-deep-equal' | 'text-equal' | 'text-contains';
}
export interface AtomicConsumerContractGateConfig {
    cases: AtomicConsumerContractCase[];
    blocking?: boolean;
}
export interface AtomicDefaultGateConfig {
    immutability?: AtomicImmutabilityGateConfig | null;
    sideEffects?: AtomicSideEffectGateConfig | null;
    consumerContract?: AtomicConsumerContractGateConfig | null;
}
export interface AtomicTestRunnerConfig {
    schemaId: 'atm.testRunnerConfig';
    specVersion: '0.1.0';
    legacyValidation?: {
        includeCommands?: boolean;
    };
    plugins?: TestRunnerPluginReference[];
    defaultGates?: AtomicDefaultGateConfig;
}
