# cli-0.1.22-v14-367

New three-arm construction for #367. CLI remains public npm `@ai-atomic-framework/cli@0.1.22`. Published 0.1.23 is not needed: the sealed #398 replay isolates a kit forwarding defect, and #374 parser/composer behavior is already supported. Old generations remain untouched. No formal runs are authorized by this kit.

Inputs: `prereg-v3-datasets/2026-10-24-six-pairs`, pinned SWE-bench Verified revision, four main pairs and two independent held-out pairs, twelve distinct instance IDs. The pilot-exposed migrations pair is main group g05. `group-compatibility.json` records both sequential gold orders; five pairs apply cleanly both ways, g05 conflicts both ways. No patch is silently repaired.

A uses shared direct Git; B uses the same shared source with Unix-user ownership and public ATM socket writes. B-wt uses a private repository plus actual worktree/branch per slot, protecting Git metadata from peers, and integrates submitted branch heads in slot order 1 then 2. Uncommitted work is captured for the end oracle but is not silently integrated as a submitted branch. All task sessions use Codex 0.163.0, gpt-6-luna, medium, k=2, zero stagger, seed null, twenty-minute wall caps. No paid fallback. Mount namespaces expose only public source/runtime/helper inputs, hiding gold, held-out data, oracle code and peer/integration paths. B additionally cannot directly edit, chmod, move or remove source files. Runtime control directories are explicitly separate from source writes.

A fresh resolver receives the fixed design prompt, original issue texts, conflicting paths and public tests only. At most two twenty-minute rounds per conflicting merge; stop requires clean conflicts and passing public tests. Record unresolved/manual effort as null where unobserved. Task, resolution, snapshot, integration and oracle costs are retained separately in raw artifacts; total arm wall includes setup and evaluation. Resolver prompt contains no hidden test feedback.

The scorer evaluates the exact captured source tree with benchmark test files restored from the captured common base and audited test patches. Source snapshots use independent indexes, verify captured blob hashes, and preserve uncommitted files without moving worker branches/indexes. Self-contained orphan export commits identify source trees; original worker HEAD/base remain recorded separately. Missing required observations, tree mismatches and any kit-error make the arm INVALID. Missing token totals are null; budgeting may use a separately labelled input+output proxy. Tool counts are unique logged tool-item IDs. M1 loss means own task succeeded at session end and failed at final; B-wt additionally requires the submitted branch oracle to succeed, and successful unsubmitted work is reported separately; blocked/unsubmitted intent alone is not a loss. Silent loss means such a loss without a logged machine conflict/rejection/BLOCKED/unresolved notice in task logs or merge receipts; it is an arm-level notification definition. B accepted-task loss additionally requires independently hash-verified accepted commit bytes. Receipt file changes alone are not called semantic losses.

Run from repository root on the recorded Linux box, with a new clone-local scratch path:

```bash
export PATH="$HOME/.local/node24-latest/bin:$HOME/.local/node22/bin:$HOME/.local/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1
export TMPDIR="$PWD/n0/t"
export PREREG_ATM_CLI="$PWD/.worklogs/public-cli/node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs"
export PREREG_PYTHON="$PWD/n0/validation-venv/bin/python"
KIT=research/paper-v2/prereg-v3-kits/cli-0.1.22-v14-367
DATA=research/paper-v2/prereg-v3-datasets/2026-10-24-six-pairs
python3 "$KIT/bin/verify-kit.py" --dataset "$DATA"
python3 "$KIT/test/test-runtime.py"
python3 "$KIT/test/test-containment.py"
python3 "$KIT/test/test-original-intent.py"
node "$KIT/bin/generate-unified-patch.mjs" --check
# The separately committed smoke condition and run-smoke.sh authorize only g05, one repetition.
# Read-only rescoring of an archived arm:
python3 "$KIT/bin/runtime.py" path/to/result.json
```

The launcher intentionally rejects held-out model sessions in smoke mode. Held-out inputs receive automated eligibility/gold validation only. Exact environment, commands, licenses and raw failures are recorded in the dataset and smoke evidence. The formal v3 plan is a separate proposal requiring user sign-off.
