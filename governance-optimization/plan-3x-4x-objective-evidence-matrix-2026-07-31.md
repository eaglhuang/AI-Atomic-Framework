# Plan 3.0–4.0 Objective Evidence Matrix

This matrix is a fail-closed certification input, not a completion claim. Each row
names machine-readable evidence and its remaining non-claim. The certificate may
become `proven` only when every row and every shared closure control is proven.

| plan | evidence tuples | current verdict | explicit non-claim |
|---|---|---|---|
| 3.0 | `ATM-GOV-0300` closure; `ATM-GOV-0307` replay closure | not-certified | A final Plan 3.0 objective replay is still required. |
| 3.1 | `ATM-GOV-0305` regression closure; `ATM-GOV-0316` runner publication | not-certified | Runner publication is not product approval; a final Plan 3.1 replay is still required. |
| 3.2 | `ATM-GOV-0312` quality closure; `ATM-GOV-0316` hostile-dogfood receipt | not-certified | Component receipts do not close the four-plan certificate. |
| 4.0 | `ATM-GOV-0314` shadow closure; `ATM-GOV-0315` adapter closure; `ATM-GOV-0324` operator closure | not-certified | An independent final review is still required. |

Shared controls remain missing: a machine-readable backlog census, final governed
release/push provenance, and an independent final-review receipt. Their absence
keeps legacy authority active. This is reversible: a later certificate may retire
that authority only after all controls and rows become `proven`.
