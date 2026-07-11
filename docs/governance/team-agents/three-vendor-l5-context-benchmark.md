# Three-Vendor L5 Context Benchmark

## Result

TASK-TEAM-0071 proves direct OpenAI, Anthropic, and Gemini roles can run under
one governed Team dispatcher. The strongest live mixed run was
`team-29b9e46a919f`: all 10 L5 roles completed with HTTP 200 across all three
providers. Provider responses and credentials are not stored in this report.

## Live Matrix

| Run | Shape | Models | Result |
|---|---|---|---|
| `team-2d987255f700` | OpenAI-only L1 | `gpt-5-nano` | 4/4 HTTP 200 |
| `team-22fd3d632bd1` | Anthropic-only L1 | `claude-haiku-4-5-20251001` | 4/4 HTTP 200 |
| `team-c33edf688984` | Gemini-only L1 | `gemini-2.5-flash-lite` | 4/4 HTTP 200 |
| `team-29b9e46a919f` | mixed L5 | Luna, nano, Haiku, Flash Lite | 10/10 HTTP 200 |

The first Gemini 2.0 attempt returned four HTTP 404 responses. A first Gemini
2.5 attempt completed two roles and returned two retryable HTTP 503 responses;
the immediate governed retry completed 4/4. These failures are retained as
availability evidence and are not counted as successful runs.

## Artifact Handoff

`three-vendor-direct-artifact-handoff` proves the production dispatcher:

- promotes only successful, redacted role previews;
- labels the Anthropic result as `implementer/anthropic`;
- includes that reference in the later OpenAI `reviewAgent` request;
- continues sibling roles when one role returns `broker-conflict-blocked`;
- caps each preview at 500 characters, the role count at four, and the combined
  handoff at 2,400 characters.

The live mixed run proves the same built dispatcher reached all three paid
vendor APIs. Full vendor output is deliberately not retained, so deterministic
request capture remains the authoritative evidence for exact prompt contents.

## Context Measurement

The source handoff is 13,876 bytes. A monolithic strategy that sends it in full
to every L5 role consumes a 138,760-byte serialized-input baseline:

```text
13,876 bytes * 10 roles = 138,760 bytes
```

The reproducible worst-case bounded calculation calls
`buildDirectTeamRoleInstructions` for the ordered L5 roster with a 500-character
preview from every prior role. The per-role character counts are:

```text
130, 733, 1253, 1780, 2305, 2303, 2302, 2306, 2304, 2307
total = 17,723 characters
```

Against the serialized monolithic baseline, the bounded strategy reduces role
input by 121,037 units, or **87.2%**. This is a UTF-8 byte versus ASCII-character
proxy, not a provider tokenizer or billing claim. It is conservative for the
bounded side because it assumes every promoted preview reaches the maximum.

## Conclusion

Team Agents materially reduce repeated Captain context in this scenario while
preserving provider diversity and reviewer provenance. The evidence supports
the context-efficiency claim, but does not claim an 87.2% reduction in billed
tokens or guarantee equivalent reasoning quality. Future telemetry should
record provider-reported input tokens so this proxy can be replaced by actual
billing units.
