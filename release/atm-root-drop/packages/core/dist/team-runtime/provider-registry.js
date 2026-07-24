import { createTeamProviderContract } from './provider-contract.js';
export class TeamProviderRegistry {
    providers = new Map();
    skillCapabilities = new Map();
    register(provider) {
        this.providers.set(provider.metadata.providerId, provider);
    }
    registerDefaults(providerIds) {
        for (const providerId of providerIds) {
            this.register(createTeamProviderContract(providerId));
        }
    }
    get(providerId) {
        return this.providers.get(providerId) ?? null;
    }
    list() {
        return [...this.providers.values()].sort((left, right) => {
            return left.metadata.providerId.localeCompare(right.metadata.providerId);
        });
    }
    registerSkillCapabilities(manifest) {
        this.skillCapabilities.set(manifest.providerId, {
            ...manifest,
            capabilities: [...new Set(manifest.capabilities)].sort(),
            atmContractVersions: [...new Set(manifest.atmContractVersions)].sort()
        });
    }
    getSkillCapabilities(providerId) {
        return this.skillCapabilities.get(providerId) ?? null;
    }
    checkSkillCapability(providerId, requiredCapability) {
        const manifest = this.skillCapabilities.get(providerId);
        if (manifest?.capabilities.includes(requiredCapability))
            return { ok: true, manifest };
        return {
            ok: false,
            evidence: {
                schemaId: 'atm.skillProviderDegradation.v1',
                providerId,
                requiredCapability,
                availableCapabilities: manifest?.capabilities ?? [],
                fallbackPolicy: manifest?.fallbackPolicy ?? 'deny',
                degraded: true,
                reason: 'unsupported-capability'
            }
        };
    }
}
