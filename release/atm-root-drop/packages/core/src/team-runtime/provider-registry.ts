import {
  createTeamProviderContract,
  type TeamProviderContract,
  type TeamProviderId
} from './provider-contract.ts';

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

export class TeamProviderRegistry {
  private readonly providers = new Map<TeamProviderId, TeamProviderContract>();
  private readonly skillCapabilities = new Map<string, SkillProviderCapabilityManifest>();

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

  registerSkillCapabilities(manifest: SkillProviderCapabilityManifest): void {
    this.skillCapabilities.set(manifest.providerId, {
      ...manifest,
      capabilities: [...new Set(manifest.capabilities)].sort(),
      atmContractVersions: [...new Set(manifest.atmContractVersions)].sort()
    });
  }

  getSkillCapabilities(providerId: string): SkillProviderCapabilityManifest | null {
    return this.skillCapabilities.get(providerId) ?? null;
  }

  checkSkillCapability(providerId: string, requiredCapability: string):
    | { readonly ok: true; readonly manifest: SkillProviderCapabilityManifest }
    | { readonly ok: false; readonly evidence: SkillProviderDegradationEvidence } {
    const manifest = this.skillCapabilities.get(providerId);
    if (manifest?.capabilities.includes(requiredCapability)) return { ok: true, manifest };
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
