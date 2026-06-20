# Chinese Mojibake Cleaner Learning Log

## Latest
- Batch 51: `total=15 ok=5 fail=10`
- `latin1: 5/5`
- `cp1252: 0/5`
- `cp1252_double: 0/5`
- Conclusion: exact equality is stable for `latin1`, but lossy `cp1252` classes still need readable-recovery scoring and phrase-level repo learning.

## Batch 52
- Goal: harder Chinese Markdown + Chinese code-comment recovery using repo-specific vocabulary and protected-token scoring.
- First exact-only result: `total=15 exact=5 readable=5`
- After repo-specific scorer + high-confidence phrase replacements: `total=15 exact=6 readable=15`
- `latin1: exact 5/5 | readable 5/5`
- `cp1252: exact 1/5 | readable 5/5`
- `cp1252_double: exact 0/5 | readable 5/5`
- Observation: hardest Chinese Markdown and Chinese code-comment fixtures are now fully readable after repair, even though lossy classes still do not reach exact byte-for-byte equality.

## Batch 53
- Goal: push into longer repo-style task cards and mixed code/comment samples with table structure and atom-map vocabulary.
- Result: `total=15 exact=5 readable=9 fail=10`
- `latin1: exact 5/5 | readable 5/5`
- `cp1252: exact 0/5 | readable 1/5`
- `cp1252_double: exact 0/5 | readable 3/5`
- Observation: long mixed Markdown and code-heavy comments still lose some key Chinese connective words under lossy `cp1252`, so the repair layer needs stronger phrase recovery for recurring repo wording.

## Batch 54
- Goal: verify the cleaner learning loop on more normal Chinese governance and code-comment text.
- Result: `total=15 exact=5 readable=12 fail=10`
- `latin1: exact 5/5 | readable 5/5`
- `cp1252: exact 0/5 | readable 3/5`
- `cp1252_double: exact 0/5 | readable 4/5`
- Observation: readable recovery improved when the source Chinese is less fragmented. The skill is now better at preserving repo tokens and broad intent, but some cp1252 cases still need phrase-specific normalization for words like `確認`, `而不是`, `關聯`, and similar connective fragments.

## Batch 55
- Goal: stress the cleaner on normal repo Chinese sentence patterns after adding phrase-level normalization.
- Result: `total=15 exact=4 readable=9 fail=11`
- `latin1: exact 4/5 | readable 4/5`
- `cp1252: exact 0/5 | readable 2/5`
- `cp1252_double: exact 0/5 | readable 3/5`
- Observation: the new normalization helped some governance phrases, but the batch shows the remaining weak spot is not just individual words. Multi-word connective phrases and sentence-shaped recoveries still need a tighter phrase map before cp1252 results become consistently readable.

## Batch 56
- Goal: push into the hardest Chinese task-card / TypeScript-comment / JSON-note / Python-comment shapes that resemble repo governance work.
- Result: `total=15 exact=4 readable=6 fail=11`
- `latin1: exact 4/5 | readable 4/5`
- `cp1252: exact 0/5 | readable 1/5`
- `cp1252_double: exact 0/5 | readable 1/5`
- Observation: the remaining failures are sentence-level, not just token-level. The cleaner still needs better handling for whole Chinese sentences that contain repo vocabulary, especially when the line ends with a damaged connective or a lost final character.

## Batch 57
- Goal: verify whether the cleaner can recover cleaner sentence-shaped Chinese documents after more phrase-level tuning.
- Result: `total=15 exact=4 readable=6 fail=11`
- `latin1: exact 4/5 | readable 4/5`
- `cp1252: exact 0/5 | readable 2/5`
- `cp1252_double: exact 0/5 | readable 0/5`
- Observation: the cleaner still benefits from repo vocabulary and protected tokens, but exact sentence recovery is not yet stable for the hardest mixed Markdown / code-comment / JSON combinations. The next gain is likely to come from direct phrase recovery for whole sentence patterns rather than more token-level rules.

## Next Focus
- Continue promoting repeated repo phrases only after multi-context confirmation.
- Expand the same readable-recovery success to older hard batches such as batch 51 weak spots.
- Keep fixtures and strategy files clean UTF-8 so the skill never learns from corrupted references.
