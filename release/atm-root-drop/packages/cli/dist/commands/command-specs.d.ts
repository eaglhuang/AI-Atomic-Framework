export declare const commandSpecs: Readonly<{
    actor: import("./shared.ts").CommandSpec;
    'agent-pack': import("./shared.ts").CommandSpec;
    'atom-capsule': Readonly<import("./shared.ts").CommandSpec & {
        visibility: "public" | "internal";
    }>;
    'atom-ref': import("./shared.ts").CommandSpec;
    atomize: import("./shared.ts").CommandSpec;
    'atm-chart': import("./shared.ts").CommandSpec;
    baseline: import("./shared.ts").CommandSpec;
    batch: import("./shared.ts").CommandSpec;
    bootstrap: import("./shared.ts").CommandSpec;
    budget: import("./shared.ts").CommandSpec;
    cache: import("./shared.ts").CommandSpec;
    candidates: import("./shared.ts").CommandSpec;
    create: import("./shared.ts").CommandSpec;
    'create-map': import("./shared.ts").CommandSpec;
    daemon: Readonly<import("./shared.ts").CommandSpec & {
        visibility: "public" | "internal";
    }>;
    doctor: import("./shared.ts").CommandSpec;
    emergency: import("./shared.ts").CommandSpec;
    experience: import("./shared.ts").CommandSpec;
    explain: import("./shared.ts").CommandSpec;
    evidence: import("./shared.ts").CommandSpec;
    'framework-mode': import("./shared.ts").CommandSpec;
    git: import("./shared.ts").CommandSpec;
    'git-hooks': import("./shared.ts").CommandSpec;
    guide: import("./shared.ts").CommandSpec;
    guard: import("./shared.ts").CommandSpec;
    handoff: import("./shared.ts").CommandSpec;
    'health-report': Readonly<import("./shared.ts").CommandSpec & {
        visibility: "public" | "internal";
    }>;
    hook: import("./shared.ts").CommandSpec;
    identity: import("./shared.ts").CommandSpec;
    init: import("./shared.ts").CommandSpec;
    'internal-release': import("./shared.ts").CommandSpec;
    integration: import("./shared.ts").CommandSpec;
    lane: import("./shared.ts").CommandSpec;
    lock: import("./shared.ts").CommandSpec;
    'map-capsule': Readonly<import("./shared.ts").CommandSpec & {
        visibility: "public" | "internal";
    }>;
    migrate: import("./shared.ts").CommandSpec;
    next: import("./shared.ts").CommandSpec;
    orient: import("./shared.ts").CommandSpec;
    police: import("./shared.ts").CommandSpec;
    quickfix: import("./shared.ts").CommandSpec;
    residue: import("./shared.ts").CommandSpec;
    rescue: Readonly<import("./shared.ts").CommandSpec & {
        visibility: "public" | "internal";
    }>;
    registry: import("./shared.ts").CommandSpec;
    'registry-diff': import("./shared.ts").CommandSpec;
    'replacement-lane': import("./shared.ts").CommandSpec;
    review: import("./shared.ts").CommandSpec;
    'review-advisory': import("./shared.ts").CommandSpec;
    rollback: import("./shared.ts").CommandSpec;
    'self-host-alpha': import("./shared.ts").CommandSpec;
    spec: import("./shared.ts").CommandSpec;
    start: import("./shared.ts").CommandSpec;
    status: import("./shared.ts").CommandSpec;
    tasks: import("./shared.ts").CommandSpec;
    test: import("./shared.ts").CommandSpec;
    telemetry: import("./shared.ts").CommandSpec;
    team: import("./shared.ts").CommandSpec;
    upgrade: import("./shared.ts").CommandSpec;
    validate: import("./shared.ts").CommandSpec;
    welcome: import("./shared.ts").CommandSpec;
    verify: import("./shared.ts").CommandSpec;
    taskflow: import("./shared.ts").CommandSpec;
    'task-view': import("./shared.ts").CommandSpec;
    broker: import("./shared.ts").CommandSpec;
    route: import("./shared.ts").CommandSpec;
}>;
export declare function getCommandSpec(commandName: string): import("./shared.ts").CommandSpec | null;
export declare function listCommandSpecs(options?: {
    includeInternal?: boolean;
}): (import("./shared.ts").CommandSpec | Readonly<import("./shared.ts").CommandSpec & {
    visibility: "public" | "internal";
}>)[];
