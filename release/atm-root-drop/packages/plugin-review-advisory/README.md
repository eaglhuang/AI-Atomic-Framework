# @ai-atomic-framework/plugin-review-advisory

Reference plugin package for semantic advisory providers.

## Goals

- Keep deterministic ATM gates as source of truth.
- Emit advisory findings that can route into human review queue context.
- Support provider modes (`stub`, `agent-bridge`, `external-cli`) without coupling to vendor SDKs.

## Non-blocking Contract

Provider unavailable or malformed responses must degrade to `advisory-unavailable` and `needs-review` hints, never to deterministic gate failure.
