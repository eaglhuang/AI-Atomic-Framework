import { type TeamProviderContract, type TeamProviderId } from './provider-contract.ts';
export declare class TeamProviderRegistry {
    private readonly providers;
    register(provider: TeamProviderContract): void;
    registerDefaults(providerIds: readonly TeamProviderId[]): void;
    get(providerId: TeamProviderId): TeamProviderContract | null;
    list(): TeamProviderContract[];
}
