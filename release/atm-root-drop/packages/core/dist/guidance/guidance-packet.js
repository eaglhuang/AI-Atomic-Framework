export const defaultMutationPolicy = Object.freeze({
    requireSession: true,
    requireDryRunProposal: true,
    requireReviewBeforeApply: true,
    allowUnguidedInDev: true,
    allowUnguidedInCI: false
});
const defaultAllowedCommands = [
    'node atm.mjs orient --cwd . --json',
    'node atm.mjs start --cwd . --goal "<goal>" --json',
    'node atm.mjs next --cwd . --json',
    'node atm.mjs explain --why blocked --json'
];
const defaultBlockedCommands = [
    'host mutation without active guidance session',
    'atomize/infect/split apply without dry-run proposal',
    'apply without human review approval',
    'apply without rollback proof or rollback instructions',
    'direct trunk function rewrite',
    'release promote while release blockers exist'
];
export function buildGuidancePacket(input) {
    const noTouch = input.orientation.noTouchZones.map((entry) => entry.path);
    const blockingGateIds = input.orientation.hostGates
        .filter((gate) => gate.blocking)
        .map((gate) => gate.gateId);
    const readFirst = buildReadFirst(input.routeDecision.recommendedRoute);
    const nextCommand = input.routeDecision.nextCommand;
    const allowedCommands = Array.from(new Set([...defaultAllowedCommands, nextCommand]));
    return {
        schemaId: 'atm.guidancePacket',
        specVersion: '0.1.0',
        sessionId: input.sessionId,
        readFirst,
        doNotTouch: noTouch,
        nextCommand,
        allowedCommands,
        blockedCommands: defaultBlockedCommands,
        requiredGates: blockingGateIds,
        missingEvidence: input.routeDecision.requiredEvidence,
        rollbackHint: 'Discard generated guidance proposals and rerun `node atm.mjs orient --cwd . --json` before retrying.',
        whyThisRoute: input.routeDecision.reasons
    };
}
export function toGuidanceNextAction(packet, blockedBy = []) {
    const blocked = blockedBy.length > 0;
    return {
        status: blocked ? 'blocked' : 'action',
        command: packet.nextCommand,
        reason: blocked ? `Blocked by: ${blockedBy.join(', ')}` : packet.whyThisRoute[0] ?? 'Guidance session selected the next action.',
        allowedCommands: packet.allowedCommands,
        blockedCommands: packet.blockedCommands,
        missingEvidence: packet.missingEvidence
    };
}
function buildReadFirst(route) {
    switch (route) {
        case 'adapter-bootstrap':
            return ['README.md', 'docs/SELF_HOSTING_ALPHA.md'];
        case 'legacy-candidate-ranking':
            return ['README.md', 'docs/QUICK_START.md'];
        case 'task-plan-import':
            return ['README.md', 'docs/QUICK_START.md', 'docs/LIFECYCLE.md'];
        case 'docs-first':
            return ['README.md', 'docs/ARCHITECTURE.md'];
        case 'atomize':
        case 'infect':
        case 'split':
            return ['README.md', 'docs/ATOM_GENERATOR.md', 'docs/LIFECYCLE.md'];
        default:
            return ['README.md', 'docs/QUICK_START.md'];
    }
}
