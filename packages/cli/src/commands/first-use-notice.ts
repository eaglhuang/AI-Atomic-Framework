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
  readonly mustShowBeforeAction: true;
  readonly summary: string;
  readonly body: string;
  readonly spokenLine: string;
  readonly agentInstruction: string;
  readonly afterNextActionInstruction: string;
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
    mustShowBeforeAction: true,
    summary: 'ATM governance is available for this repository.',
    body: 'The project now has an ATM entrypoint. A user can keep asking ordinary natural-language requests while ATM keeps the next governed action explicit.',
    spokenLine: 'This repository is connected to ATM governance. I will use the ATM route quietly in the background and keep helping with your original request.',
    agentInstruction: 'If this notice is present, you MUST briefly tell the user, in their language when practical, that ATM governance is available before executing the returned nextAction.command. Mention at most one or two suggested actions, then continue.',
    afterNextActionInstruction: 'After the returned nextAction.command completes, return to the user original request and continue the actual work instead of stopping at onboarding.',
    suggestedPrompts: [
      'Show me which ATM features I can try now.',
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
      },
      {
        label: 'List editor integrations',
        kind: 'command',
        value: 'node atm.mjs integration list --cwd . --json',
        reason: 'Shows which repo-local editor adapters are available so the current tool can install its own ATM entry files.'
      }
    ]
  };
}
