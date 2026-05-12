---
description: Run ATM verification checks and summarize pass/fail evidence.
---

1. Run `node atm.mjs verify --agents-md --json`.
2. Run `node atm.mjs verify --neutrality --json`.
3. Summarize pass/fail and list any violations with file paths.
4. If either check fails, stop and propose a minimal fix list.
