const fastPaths = new Set(['handoff', 'knowledge', 'broker', 'observability']);
const specialActions = new Set(['wave', 'knowledge', 'broker', 'observability']);
const lifecycleActions = new Set(['lease', 'release', 'complete', 'abandon']);
const planningActions = new Set(['plan', 'start', 'validate']);
export function isSupportedTeamAction(action) {
    return action === 'status'
        || action === 'patrol'
        || lifecycleActions.has(action)
        || planningActions.has(action)
        || specialActions.has(action);
}
export function resolveTeamFastPath(argv) {
    const first = String(argv[0] ?? '').toLowerCase();
    if (!fastPaths.has(first))
        return null;
    return {
        kind: 'fast-path',
        fastPath: first,
        argv: argv.slice(1).map(String),
        cwdSource: first === 'broker' ? 'process' : 'option-or-process'
    };
}
export function resolveTeamActionRoute(actionValue, positionalTail) {
    const action = String(actionValue ?? 'plan').toLowerCase();
    if (!isSupportedTeamAction(action)) {
        return {
            kind: 'planning',
            action: 'plan'
        };
    }
    if (specialActions.has(action)) {
        return {
            kind: 'special-action',
            action: action,
            argv: positionalTail.map(String)
        };
    }
    if (action === 'status')
        return { kind: 'status', action };
    if (action === 'patrol')
        return { kind: 'patrol', action };
    if (lifecycleActions.has(action)) {
        return {
            kind: 'lifecycle',
            action: action
        };
    }
    return {
        kind: 'planning',
        action: action
    };
}
export function supportedTeamActionList() {
    return 'plan, start, status, validate, patrol, lease, release, complete, abandon, wave, knowledge, broker resolve, observability query';
}
