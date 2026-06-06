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
export declare function buildFirstUseUserNotice(nextAction: NextActionLike): AtmUserNotice | null;
