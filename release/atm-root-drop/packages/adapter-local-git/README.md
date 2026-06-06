# @ai-atomic-framework/adapter-local-git

Local Git adapter translates a standalone repository into ATM core records without requiring a host governance service.

The reference implementation focuses on three ATM-1 guarantees:

- scaffold a local `.atm` workspace for a repository;
- resolve and use a filesystem registry path;
- expose lock, gate, and doc operations as explicit no-op results until a host chooses to attach stronger policies.

No-op operations still return machine-readable evidence so agents can tell the difference between "not configured yet" and "failed".