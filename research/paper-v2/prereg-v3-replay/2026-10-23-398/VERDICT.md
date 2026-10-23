# Issue 398 diagnostic replay: kit attribution

Model-free replay of the four original r12f submissions with receipt-verified patch hashes, original session slots and Django startup base 98ad327864aed8df245fd19ea9d2743279e11643. No --base-file or --attempt was supplied to the old kit. CLI 0.1.22 and old immutable kit cli-0.1.22-v13-367 are verified in the identity records. No old artifact was changed.

Old kit: S2 malformed → S1 accepted guard → S2 malformed refresh → S2 accepted removal; the guard is absent at the end. Direct published CLI, same patch bytes, actors, task window and reply-derived declared bases: the malformed initial proposal records the original anchor, and the final removal is rejected as cross-session-overlap; the guard remains. Each step retains before/after bytes, commands, stdout/stderr, HEAD, and reason.

Attribution: the old kit rejects malformed patches locally before calling the CLI, then refreshes its seen-base hash. Core never sees S2's original intent; its first valid proposal arrives against the newer hash. The direct public CLI already anchors before parsing. Fix the kit path to establish the CLI anchor even for a malformed first submission; do not claim a core-only defect or change core based on this replay. Regression must also retain same-actor/disjoint behavior and distinguish model rejection from infrastructure failure.

This replay is sealed before the fix, uses zero model calls, and is diagnostic pipeline evidence, not formal data. No win claim. Missing token/tool cost measurements are null, not zero; modelCalls=0 is an observed execution count.
