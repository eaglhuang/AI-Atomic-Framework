import { type TeamProviderContract, type TeamProviderId } from './provider-contract.js';
export type SkillProviderCapabilityManifest = {
    readonly schemaId: 'atm.skillDefinition.vNext';
    readonly providerId: string;
    readonly providerVersion: string;
    readonly capabilities: readonly string[];
    readonly atmContractVersions: readonly string[];
    readonly fallbackPolicy: 'deny' | 'degrade-with-evidence' | 'legacy-compatible';
    readonly rollbackPolicy: 'provider-only' | 'manifest-only' | 'full-revert';
};
export type SkillProviderDegradationEvidence = {
    readonly schemaId: 'atm.skillProviderDegradation.v1';
    readonly providerId: string;
    readonly requiredCapability: string;
    readonly availableCapabilities: readonly string[];
    readonly fallbackPolicy: SkillProviderCapabilityManifest['fallbackPolicy'];
    readonly degraded: true;
    readonly reason: 'unsupported-capability';
};
export declare class TeamProviderRegistry {
    private readonly providers;
    private readonly skillCapabilities;
    register(provider: TeamProviderContract): void;
    registerDefaults(providerIds: readonly TeamProviderId[]): void;
    get(providerId: TeamProviderId): TeamProviderContract | null;
    list(): TeamProviderContract[];
    registerSkillCapabilities(manifest: SkillProviderCapabilityManifest): void;
    getSkillCapabilities(providerId: string): SkillProviderCapabilityManifest | null;
    checkSkillCapability(providerId: string, requiredCapability: string): {
        readonly ok: true;
        readonly manifest: SkillProviderCapabilityManifest;
    } | {
        readonly ok: false;
        readonly evidence: SkillProviderDegradationEvidence;
    };
}
