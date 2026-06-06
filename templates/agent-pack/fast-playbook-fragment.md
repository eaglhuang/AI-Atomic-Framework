<!-- doc_id: doc_templates_agent_pack_fast_fragment -->
<!--
  Reusable fast-channel playbook fragment for small low-risk edits.
  Source of truth: docs/governance/batch-playbook.md
-->

## ATM fast channel (quickfix)

Only for small, low-risk edits (typos, missing comments, trivial follow-ups
from another card). **Not** a task-card closure path.

### Command sequence

```bash
node atm.mjs next --claim --actor <id> --prompt "<short description>" --json
# Edit ONLY the allowed files returned by ATM
# Run the smallest relevant validator
git add <changed files>
git commit -m "<message>"
```

### Don't

- ❌ Edit `.atm/history/**`.
- ❌ Close task cards in this channel.
- ❌ Expand the scope after the quickfix lock is created.
- ❌ Use fast channel to bypass a real task card; if you find yourself
  wanting that, open a task card and use the normal channel.

### Full reference

`docs/governance/batch-playbook.md`
