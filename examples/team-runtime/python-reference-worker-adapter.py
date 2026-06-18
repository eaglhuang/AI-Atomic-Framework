"""Reference Python Team worker adapter metadata.

Node.js remains the default ATM Team runtime. This example only shows how a
Python bridge can express the same worker adapter contract without weakening
broker, lease, evidence, validator, artifact, retry, or closure authority gates.
"""

from __future__ import annotations

from typing import Any


PRESERVED_GOVERNANCE = [
    "broker",
    "permission-leases",
    "validators",
    "police",
    "evidence",
    "artifact-contract",
    "retry-contract",
    "closure-authority",
]


def build_python_reference_worker_adapter(
    *,
    provider_id: str = "local",
    sdk_id: str = "python-reference",
    model_id: str = "provider-selected",
) -> dict[str, Any]:
    """Return ATM Team worker adapter metadata for a Python bridge."""

    return {
        "schemaId": "atm.teamWorkerAdapterContract.v1",
        "adapterId": "atm.python.reference-worker",
        "runtimeMode": "real-agent",
        "runtimeLanguage": "python",
        "executionSurface": "agent-runtime",
        "providerId": provider_id,
        "sdkId": sdk_id,
        "modelId": model_id,
        "spawnStrategy": "spawn-worker",
        "agentsSpawned": True,
        "brokerFallback": {
            "enabled": False,
            "reason": "Python reference workers still fall back to broker-only governance when a host cannot spawn workers.",
            "preservesGovernance": PRESERVED_GOVERNANCE,
        },
        "vendorNeutral": True,
        "artifactContractPreserved": True,
        "retryContractPreserved": True,
        "closureAuthorityPreserved": True,
        "commandBackedEvidenceRequired": True,
    }


if __name__ == "__main__":
    import json

    print(json.dumps(build_python_reference_worker_adapter(), indent=2, sort_keys=True))
