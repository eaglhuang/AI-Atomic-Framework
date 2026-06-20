import {
  createTeamProviderContract,
  type TeamProviderContract,
  type TeamProviderId
} from './provider-contract.ts';

export class TeamProviderRegistry {
  private readonly providers = new Map<TeamProviderId, TeamProviderContract>();

  register(provider: TeamProviderContract): void {
    this.providers.set(provider.metadata.providerId, provider);
  }

  registerDefaults(providerIds: readonly TeamProviderId[]): void {
    for (const providerId of providerIds) {
      this.register(createTeamProviderContract(providerId));
    }
  }

  get(providerId: TeamProviderId): TeamProviderContract | null {
    return this.providers.get(providerId) ?? null;
  }

  list(): TeamProviderContract[] {
    return [...this.providers.values()].sort((left, right) => {
      return left.metadata.providerId.localeCompare(right.metadata.providerId);
    });
  }
}
