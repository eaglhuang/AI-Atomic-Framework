import { createTeamProviderContract } from './provider-contract.js';
export class TeamProviderRegistry {
    providers = new Map();
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
}
