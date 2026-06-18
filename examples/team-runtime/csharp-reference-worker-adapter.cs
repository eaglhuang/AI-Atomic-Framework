using System.Collections.Generic;

namespace Atm.TeamRuntime.Examples;

// Node.js remains the default ATM Team runtime. This example only describes the
// metadata shape a C# bridge must preserve before any real worker is spawned.
public sealed record TeamWorkerAdapterContract(
    string SchemaId,
    string AdapterId,
    string RuntimeMode,
    string RuntimeLanguage,
    string ExecutionSurface,
    string ProviderId,
    string SdkId,
    string ModelId,
    string SpawnStrategy,
    bool AgentsSpawned,
    BrokerFallbackContract BrokerFallback,
    bool VendorNeutral,
    bool ArtifactContractPreserved,
    bool RetryContractPreserved,
    bool ClosureAuthorityPreserved,
    bool CommandBackedEvidenceRequired
);

public sealed record BrokerFallbackContract(
    bool Enabled,
    string Reason,
    IReadOnlyList<string> PreservesGovernance
);

public static class CSharpReferenceWorkerAdapter
{
    private static readonly string[] PreservedGovernance =
    [
        "broker",
        "permission-leases",
        "validators",
        "police",
        "evidence",
        "artifact-contract",
        "retry-contract",
        "closure-authority",
    ];

    public static TeamWorkerAdapterContract Build(
        string providerId = "local",
        string sdkId = "csharp-reference",
        string modelId = "provider-selected"
    ) => new(
        SchemaId: "atm.teamWorkerAdapterContract.v1",
        AdapterId: "atm.csharp.reference-worker",
        RuntimeMode: "real-agent",
        RuntimeLanguage: "csharp",
        ExecutionSurface: "agent-runtime",
        ProviderId: providerId,
        SdkId: sdkId,
        ModelId: modelId,
        SpawnStrategy: "spawn-worker",
        AgentsSpawned: true,
        BrokerFallback: new BrokerFallbackContract(
            Enabled: false,
            Reason: "C# reference workers still fall back to broker-only governance when a host cannot spawn workers.",
            PreservesGovernance: PreservedGovernance
        ),
        VendorNeutral: true,
        ArtifactContractPreserved: true,
        RetryContractPreserved: true,
        ClosureAuthorityPreserved: true,
        CommandBackedEvidenceRequired: true
    );
}
