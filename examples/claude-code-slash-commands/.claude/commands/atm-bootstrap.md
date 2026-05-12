---
description: Bootstrap ATM only when the repository has not been initialized.
---

1. Check whether `.atm/config.json` already exists.
2. If missing, run:
   - `node atm.mjs bootstrap --task "Bootstrap ATM in this repository" --json`
3. If present, do not re-bootstrap; continue with `node atm.mjs next --json`.
4. Report which path you took and include command output evidence.
