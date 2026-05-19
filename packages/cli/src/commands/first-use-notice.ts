export interface AtmSuggestedAction {
  readonly label: string;
  readonly kind: 'command' | 'prompt';
  readonly value: string;
  readonly reason: string;
}

export interface AtmUserNotice {
  readonly schemaVersion: 'atm.userNotice.v0.1';
  readonly id: 'atm.first-use.governance-available';
  readonly audience: 'human';
  readonly severity: 'info';
  readonly displayPolicy: 'show-on-first-contact';
  readonly summary: string;
  readonly body: string;
  readonly agentInstruction: string;
  readonly suggestedPrompts: readonly string[];
  readonly suggestedActions: readonly AtmSuggestedAction[];
}

export interface NextActionLike {
  readonly status: string;
  readonly command: string;
  readonly reason: string;
}

const firstUseStatuses = new Set([
  'needs-bootstrap',
  'needs-onboarding-refresh',
  'needs-guidance-start'
]);

export function buildFirstUseUserNotice(nextAction: NextActionLike): AtmUserNotice | null {
  if (!firstUseStatuses.has(nextAction.status)) {
    return null;
  }

  return {
    schemaVersion: 'atm.userNotice.v0.1',
    id: 'atm.first-use.governance-available',
    audience: 'human',
    severity: 'info',
    displayPolicy: 'show-on-first-contact',
    summary: 'ATM governance is available for this repository.',
    body: 'The project now has an ATM entrypoint. The agent can continue from natural-language requests while ATM keeps the next governed action explicit.',
    agentInstruction: 'If this notice is present, briefly tell the user ATM governance is available, mention one or two suggested actions, then continue with the returned nextAction.command when appropriate.',
    suggestedPrompts: [
      'Show me which ATM features are ready to try.',
      'Help me understand the current governed next step.',
      'Check whether this project is ready for atomic development.'
    ],
    suggestedActions: [
      {
        label: 'Continue the current ATM route',
        kind: 'command',
        value: nextAction.command,
        reason: nextAction.reason
      },
      {
        label: 'List starter ATM features',
        kind: 'prompt',
        value: 'Show me which ATM features are ready to try.',
        reason: 'Lets a user discover ATM capabilities without memorizing commands.'
      },
      {
        label: 'Inspect project readiness',
        kind: 'command',
        value: 'node atm.mjs doctor --cwd . --json',
        reason: 'Reports the current governance, onboarding, and integration health.'
      }
    ]
  };
}
