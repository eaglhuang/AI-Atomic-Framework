export declare const defaultSkillTemplateDirectory: string;
export type SkillTemplateAdapterTarget = 'claude-code' | 'copilot' | 'cursor' | 'gemini' | 'codex';
export interface AtmSkillTemplateFrontmatter {
    readonly schemaId: 'atm.skillTemplate';
    readonly specVersion: '0.1.0';
    readonly id: string;
    readonly title: string;
    readonly summary: string;
    readonly command: string;
    readonly firstCommand: string;
    readonly 'charter-invariants-injected': boolean;
    readonly handoffs: string;
}
export interface AtmSkillTemplate {
    readonly frontmatter: AtmSkillTemplateFrontmatter;
    readonly body: string;
    readonly sourcePath: string;
}
export interface CompileSkillTemplateOptions {
    readonly repositoryRoot?: string;
}
export declare const minimumAtmEntrySkillDefinitions: readonly [{
    readonly id: "atm-next";
    readonly title: "ATM Next";
    readonly summary: "Recommend the next official ATM guidance action from current state.";
    readonly command: "node atm.mjs next --prompt \"$ARGUMENTS\" --json";
}, {
    readonly id: "atm-task-intent-resolver";
    readonly title: "ATM Task Intent Resolver";
    readonly summary: "Resolve the current user prompt into an atm.taskIntent.v1 proposal before next-action routing.";
    readonly command: "node atm.mjs next --intent .atm/runtime/task-intent.json --json";
}, {
    readonly id: "atm-orient";
    readonly title: "ATM Orient";
    readonly summary: "Inspect a repository and emit a guidance orientation report.";
    readonly command: "node atm.mjs orient --cwd . --json";
}, {
    readonly id: "atm-governance-router";
    readonly title: "ATM Governance Router";
    readonly summary: "Route natural-language cleanup, refactor, migration, and candidate ranking goals through ATM before local analysis.";
    readonly command: "node atm.mjs guide --goal \"$ARGUMENTS\" --cwd . --json";
}, {
    readonly id: "atm-dispatch";
    readonly title: "ATM Dispatch";
    readonly summary: "ATM Captain dispatch routing for task cards, sidecars, subagents, condition review, mailbox work, and closeout coordination.";
    readonly command: "node atm.mjs next --prompt \"$ARGUMENTS\" --json";
}, {
    readonly id: "atm-create";
    readonly title: "ATM Create";
    readonly summary: "Create and register an atom through the provisioning facade.";
    readonly command: "node atm.mjs create --bucket CORE --title \"$ARGUMENTS\" --dry-run --json";
}, {
    readonly id: "atm-lock";
    readonly title: "ATM Lock";
    readonly summary: "Check, acquire, or release a governed scope lock.";
    readonly command: "node atm.mjs lock check --json";
}, {
    readonly id: "atm-evidence";
    readonly title: "ATM Evidence";
    readonly summary: "Explain missing evidence or blocked guidance before proceeding.";
    readonly command: "node atm.mjs explain --why blocked --json";
}, {
    readonly id: "atm-error-code-resolver";
    readonly title: "ATM Error Code Resolver";
    readonly summary: "Resolve ATM_* error codes from CLI JSON, logs, or user reports into canonical meaning, remediation, retryability, and approval guidance.";
    readonly command: "node atm.mjs next --prompt \"$ARGUMENTS\" --json";
}, {
    readonly id: "atm-plan-authoring";
    readonly title: "ATM Plan Authoring";
    readonly summary: "Create registered planning families, plan documents, and task cards through the tool-first plan CLI.";
    readonly command: "node atm.mjs plan card create $ARGUMENTS --dry-run --json";
}, {
    readonly id: "atm-upgrade-scan";
    readonly title: "ATM Upgrade Scan";
    readonly summary: "Scan evidence reports and draft governed upgrade proposals.";
    readonly command: "node atm.mjs upgrade --scan --input \"$ARGUMENTS\" --json";
}, {
    readonly id: "atm-handoff";
    readonly title: "ATM Handoff";
    readonly summary: "Write a continuation summary for governed work.";
    readonly command: "node atm.mjs handoff summarize --task \"$ARGUMENTS\" --json";
}, {
    readonly id: "mailbox-worker-execution";
    readonly title: "Mailbox Worker Execution";
    readonly summary: "Mailbox worker execution workflow for agents that claim dispatch cards, complete scoped work, run required checks, and report done or blocked with evidence.";
    readonly command: "node atm.mjs next --prompt \"$ARGUMENTS\" --json";
}, {
    readonly id: "atm-internal-build-sync";
    readonly title: "ATM Internal Build Sync";
    readonly summary: "Build the ATM framework runner and sync it to explicit internal adopter repositories with skip/exclude controls.";
    readonly command: "node atm.mjs internal-release sync $ARGUMENTS --json";
}, {
    readonly id: "atm-atom-map-refactor";
    readonly title: "ATM Atom Map Refactor";
    readonly summary: "Plan ATM framework refactors by preserving atom/map semantics before splitting large governance modules.";
    readonly command: "node atm.mjs next --prompt \"$ARGUMENTS\" --json";
}, {
    readonly id: "atm-memory-consolidate";
    readonly title: "ATM Memory Consolidate";
    readonly summary: "Reflective consolidation pass over a repository's keep-memory notes — merge duplicates, retire stale entries, rebuild the summary index.";
    readonly command: "node atm.mjs next --prompt \"$ARGUMENTS\" --json";
}];
export declare function parseSkillTemplate(content: string, sourcePath?: string): AtmSkillTemplate;
export declare function loadSkillTemplates(templateDirectory?: string): readonly AtmSkillTemplate[];
export declare function loadMinimumAtmSkillTemplates(templateDirectory?: string): readonly AtmSkillTemplate[];
