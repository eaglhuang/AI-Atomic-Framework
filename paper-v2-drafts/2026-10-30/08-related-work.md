# 8. Related Work

> Status: DRAFTED. Sources: `P/related-work/2026-10-15-r2/README.md` (14-entry index, with how much of each paper was read), `…/pr-conflict-evidence.md`, `…/related-papers-2026-10-15.md` (BibTeX §13), DRAFT-zh §7.2. Figures are as reported by the cited papers; we did not re-measure them. Entries marked [VERIFY] need bibliographic confirmation before submission.

## 8.1 Pre-write admission and the v1 baseline

ATM v1 (arXiv:2607.00041) defines the seven-layer admission gate, the neutral steward and governance substrate on which this paper builds. Apodex 1.1 (arXiv:2608.23283; AgentOS 1.1 §3.3.4) describes a single-publisher lease, a pre-enforced path list, fail-closed behaviour and baseline reconciliation — mechanisms close to our steward, CAS revalidation and G3 — but does not evaluate them separately. Spec-Driven Development (arXiv:2609.00252) argues that specifications act as contracts between humans and agents, comparable to v1's Task Contract; the authors state that it relies on grey literature and is unvalidated.

Claim Plane (Nikolaev, arXiv:2607.21909v1, submitted 2026-07-24, *Claim Plane: Enforceable Change Intents and Dynamic Scope for Parallel Coding Agents*) treats concurrent change as pre-write admission over versioned ChangeIntents (exact base commit, typed resources, committed vs contingent operations), constrains same-file parallelism to declared regions, serializes unresolved overlap and fails closed on ambiguous authority; its six-pair CooperBench check is explicitly feasibility-only. The confirmatory follow-up (arXiv:2608.00947v1, submitted 2026-08-02, *Claim Plane: Reliability Gains and the Limits of Selective Concurrency for Parallel Coding Agents: A 30-Pair, Three-Seed Confirmatory Study of Deterministic Pre-Write Admission*) reports, on 30 frozen CooperBench pairs × 3 seeds × 4 arms (360 executions), pair pass 23.3% → 50.0% under static admission, with 96.7% of executions serialized. Both are admission-layer systems; neither measures whether accepted same-file edits survive commit, the layer this paper targets. (Identifiers, titles, author and dates verified on arxiv.org abstract pages, 2026-10-30; full texts not read; figures as reported in the abstracts. DRAFT-zh ref. [14] omits the "Claim Plane:" prefix and the subtitle of 2608.00947.)

## 8.2 Shared-workspace and write-layer coordination

AgentRoom (arXiv:2608.23740) is the closest write-layer neighbour: file-level advisory claims combined with a CRDT-backed workspace; it observes silent overwrites without coordination but does not count lost updates. CodeCRDT (arXiv:2510.18893) is the CRDT shared-state predecessor and reports 5–10% semantic conflicts in its abstract. CAID (arXiv:2603.21489, §4.1) compares instruction-level "soft isolation" with physical worktree isolation and finds instruction-level isolation insufficient, supporting a *mandatory* write path. Classic collaborative-editing theory — operational transformation (Ellis & Gibbs, 1989) and CRDTs (Shapiro et al., 2011) — guarantees convergence of concurrent operations; our contract is narrower and different: a fail-closed batch over a restricted patch subset, where non-composable proposals are rejected with receipts rather than transformed.

## 8.3 Concurrency control and textual merging

Optimistic concurrency control (Kung & Robinson, 1981) validates at commit and retries; our steward combines version revalidation with deterministic composition inside one mutual-exclusion section (§3.4). `git merge-file` / three-way merge is both a baseline (`textual_merge_file`) and the legality oracle of the shared compose inbox (§3.3). We stress that composition determinism is not serializability (§4.4).

## 8.4 Measuring agent coordination and conflicts

Destefanis & Aste (arXiv:2608.16801) measure coordination structure and cost in multi-agent coding without measuring write integrity; their pre-registration and deviations-table style informs ours. The Collaboration Tax (arXiv:2608.22152) defines coordination cost relative to a full-information single agent; The Collaboration Gap (arXiv:2511.02687; abstract only read) benchmarks open-world cooperation. AgentRadio (arXiv:2607.28430) represents the communication layer; its evaluation forbids editing source files, the complement of the layer ATM governs. MAST (arXiv:2503.13657) offers a 14-mode, 3-category multi-agent failure taxonomy, not concerned with writes.

## 8.5 Empirical evidence of agent PR conflicts

arXiv:2607.04697 finds concurrently active agent PR pairs in 40.2% of repositories, a 41.7% cross-agent textual conflict rate, and distinguishes textual/build/semantic conflicts. AgenticFlict (arXiv:2604.03551) is a dataset of agent-PR conflicts against base (27.67% textual conflicts); we explain why HIST uses its own pair mining (common octopus base, overlap strata) rather than AgenticFlict directly [TODO: one sentence on the reason]. Campos Junior & Murta (SBES 2026) report 29.5% conflicting internal merges in agent PRs (14,960/50,700), 96.1% resolved by human commits; at PR level 3.4% overall and 59.1% among PRs with internal merges. CooperBench (arXiv:2601.13295) separates spatial from semantic coordination and attributes 33.2% of failures to duplicated implementations that overwrite details — motivating C1′ while delimiting that ATM does not guarantee semantic compatibility. Human-developer conflict literature (Brun et al. 2011; Ghiotto et al. 2020; Brindescu et al. 2020; Vale et al. 2022) is summarised in `pr-conflict-evidence.md`.

## 8.6 Historical PR replay

STALE (Xia, Wu, Park, EXPRESS '26) supplies the historical-PR replay methodology; HIST v1.1 follows its method (not its data), and its semantic endpoint uses STALE's union-test-patch approach (06b).

## 8.7 Positioning

Prior work either measures coordination after the fact, coordinates at the communication layer, or converges shared state (CRDT/OT). ATM 2.0 sits at the commit layer: it makes the *integration* of admitted same-file proposals a governed, receipt-producing, fail-closed step, and evaluates it against equally atomic baselines on real PR data.
