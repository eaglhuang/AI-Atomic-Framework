# Team Runtime Reference Adapters

Node.js remains the default Team runtime for ATM. The examples in this directory are reference worker adapter shapes for hosts that want to describe Python or C# workers with the same `atm.teamWorkerAdapterContract.v1` metadata contract.

These examples are not alternate closeout authorities. A Python or C# worker still operates behind the same broker, permission lease, validator, police, evidence, artifact handoff, retry, and closure authority gates as the Node.js reference adapter. Command-backed evidence is still required before closeout, and the Captain-owned task lifecycle remains unchanged.

Use these files as implementation sketches when building a real runtime bridge:

- `python-reference-worker-adapter.py` returns a dependency-free Python dictionary for `atm.python.reference-worker`.
- `csharp-reference-worker-adapter.cs` returns a C# record graph for `atm.csharp.reference-worker`.

Both examples preserve the same governance list as the Node.js broker fallback contract. They intentionally avoid vendor-specific SDK assumptions and do not make Python or C# the default ATM runtime.
