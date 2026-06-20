# Repo Learning Strategy

This skill should optimize for this repository's real recovery needs first:
Chinese Markdown documents, ATM task cards, governance notes, and Chinese
comments or string literals inside TypeScript utilities.

## Fastest Feedback Loop

1. Classify the corruption before repairing.
   - `latin1`: usually reversible by byte round-trip.
   - `cp1252`: often partially lossy; use repo vocabulary to choose readable text.
   - `cp1252_double`: often needs phrase-level recovery, not character-only repair.
   - `mixed`: preserve code tokens first, then repair surrounding prose.

2. Score by repo meaning, not only by CJK count.
   Prefer candidates that preserve ATM terms, task lifecycle words, and code tokens.
   A candidate with fewer Chinese characters but intact `taskflow`, `owner-null`, and
   `foreign-staged` may be better than a longer candidate with garbled governance terms.

3. Learn from small fragments.
   Do not try to memorize entire broken documents. Extract repeated corrupt fragments,
   expected clean phrase, context, confidence, and failure mode.

4. Separate exact recovery from readable recovery.
   `latin1` should target exact equality. `cp1252` and `cp1252_double` should target
   "repo-readable" recovery when bytes were already replaced by U+FFFD.

## Best Training Materials

Use short, dense samples instead of long random files.

### Markdown Task Card Samples

Include:
- headings with task IDs: `TASK-RFT-0009`, `TASK-AAO-0145`
- lifecycle terms: preflight, 開工, close, 收尾, 驗證, 綠燈
- governance terms: active claim, close-window, closure packet, evidence, guard
- mixed code tokens: `owner`, `fallback-owner`, `payload.trace.severity`

Why: these are the repo's highest-value human-facing documents.

### TypeScript Comment Samples

Include:
- line comments before branch decisions
- JSDoc blocks with Chinese descriptions
- string literals containing Chinese diagnostics
- mixed punctuation around template strings

Why: code comments must not damage syntax, quotes, backticks, or interpolation.

### JSON/YAML-Like Governance Samples

Include:
- quoted Chinese values
- arrays with mixed English and Chinese tags
- paths, task IDs, actor IDs, and timestamps

Why: many ATM artifacts are structured; repair must preserve machine-readable shape.

## Human Judgment Rules

Use these before accepting a repair:

- Preserve code tokens exactly: backticks, task IDs, file paths, option names, JSON keys.
- Prefer Traditional Chinese terms used by this repo.
- Do not invent new task IDs, owners, paths, or commands.
- If a fragment is unrecoverable, mark it as low confidence instead of guessing.
- Prefer readable governance meaning over character-by-character overfitting for lossy cp1252 cases.

## Difficulty Ladder

1. Clean Chinese Markdown with inline code.
2. Markdown with task IDs and lifecycle vocabulary.
3. TypeScript comments and string literals.
4. JSON values with Chinese notes.
5. Mixed Markdown tables and bullet lists.
6. `cp1252` lossy text with U+FFFD.
7. `cp1252_double` mixed with preserved code tokens.
8. Existing corrupted skill logs or handoff notes.

