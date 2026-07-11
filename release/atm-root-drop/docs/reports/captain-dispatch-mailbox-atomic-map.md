# Captain Dispatch Mailbox Atomic Map (TASK-RFT-0005)

Facade + Strategy Map (inbox / outbox / reports lanes).

## Pre / Post

| Module | Pre | Post |
|---|---:|---:|
| `scripts/captain-dispatch-mailbox.ts` | 2009 | ~124 (Facade + `main`) |
| `layout.ts` | — | ~111 |
| `ledger.ts` | — | ~32 |
| `cli.ts` | — | ~192 |
| `stop-loss.ts` | — | ~358 |
| `frontmatter.ts` | — | ~262 |
| `lanes/inbox.ts` | — | ~135 |
| `lanes/outbox.ts` | — | ~223 |
| `lanes/reports.ts` | — | ~60 |

Supporting modules (in scope amendment): `types.ts`, `constants.ts`, `fs-utils.ts`, `render.ts`.

## Public surface

Entry remains `node --strip-types scripts/captain-dispatch-mailbox.ts ...`. Owned exports are re-exported from the facade for tests and validators.
