# Chinese Mojibake Cleaner

This skill is a reusable workflow for fixing Chinese mojibake.
It uses:
- low-risk replacement map,
- multi-step codec round-trip candidates,
- `ftfy` fallback,
- candidate scoring by CJK ratio / noise / length consistency.

Core scripts:
- scripts/repair_text.py
- scripts/create_batch51.py
- scripts/eval_batch.py
- references/learning-log.md

Repo-specific learning references:
- references/repo-learning-strategy.md
- references/repo-feedback-rules.json
- references/repo-feedback-examples.json
- references/repo-training-material-plan.json

When repairing this repo's Chinese Markdown or Chinese code comments, read the
repo-specific learning references before relying on generic mojibake repair.
Prefer readable repo meaning and protected-token preservation for lossy cp1252
cases; prefer exact equality for reversible latin1 cases.
