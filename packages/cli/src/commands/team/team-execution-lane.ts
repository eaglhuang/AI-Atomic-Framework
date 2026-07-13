export type TeamStartExecutionLane = {
  executeRequested: boolean;
  providerExecutionCount: number;
  executionBlocked: boolean;
  messageCode: 'ATM_TEAM_STARTED' | 'ATM_TEAM_STARTED_EXECUTED' | 'ATM_TEAM_EXECUTION_BLOCKED';
  messageLevel: 'info' | 'error';
  messageText: string;
};

export function resolveTeamStartExecutionLane(input: {
  executeRequested: boolean;
  providerExecutionCount: number;
  providerResultOk: readonly boolean[];
}): TeamStartExecutionLane {
  const executionBlocked = input.executeRequested && (
    input.providerExecutionCount === 0
    || input.providerResultOk.some((ok) => !ok)
  );
  const executed = input.executeRequested && input.providerExecutionCount > 0;
  return {
    executeRequested: input.executeRequested,
    providerExecutionCount: input.providerExecutionCount,
    executionBlocked,
    messageCode: executed
      ? 'ATM_TEAM_STARTED_EXECUTED'
      : executionBlocked
        ? 'ATM_TEAM_EXECUTION_BLOCKED'
        : 'ATM_TEAM_STARTED',
    messageLevel: executionBlocked ? 'error' : 'info',
    messageText: executed
      ? 'Team run started and governed provider orchestration executed.'
      : executionBlocked
        ? 'Team run state was written, but the explicit provider execution request was blocked or at least one provider role failed.'
        : 'Team run started. Runtime state was written, but no agents were spawned.'
  };
}

export function runtimeBackendAdmissionForTeam(input: {
  runtimeMode: string;
  providerId: string | null | undefined;
  executionSurface: string;
  capabilities: readonly {
    providerId: string;
    status: string;
    runtimeModes: readonly string[];
    executionSurfaces: readonly string[];
    manifestPath: string;
  }[];
}) {
  if (input.runtimeMode === 'broker-only') {
    return {
      ok: true,
      reason: 'broker-only mode is governed by Team Broker and does not require a declared runtime backend.'
    };
  }
  const providerId = input.providerId ?? '';
  const matchingCapability = input.capabilities.find((capability) => {
    return capability.providerId === providerId
      && capability.status !== 'unavailable'
      && capability.runtimeModes.includes(input.runtimeMode)
      && capability.executionSurfaces.includes(input.executionSurface);
  }) ?? null;
  if (matchingCapability) {
    return {
      ok: true,
      reason: `Runtime backend declared by ${matchingCapability.manifestPath}.`
    };
  }
  return {
    ok: false,
    reason: `Team runtime start requires an integration manifest teamRuntimeCapabilities entry for provider ${providerId || '(missing)'}, mode ${input.runtimeMode}, and surface ${input.executionSurface}. Installed editor integrations are not runtime backends unless their manifest declares this capability.`
  };
}
