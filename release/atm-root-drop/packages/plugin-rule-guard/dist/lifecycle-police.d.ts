import type { LifecyclePoliceFinding, LifecyclePoliceNotice, LifecyclePoliceReport } from '@ai-atomic-framework/plugin-sdk';
export declare const LIFECYCLE_POLICE_WRITER = "lifecycle-police";
export declare function canWriteQuarantine(actor: string): boolean;
export declare function buildCallerMigrationNotices(findings: readonly LifecyclePoliceFinding[]): readonly LifecyclePoliceNotice[];
export interface LifecyclePoliceInputEntry {
    readonly atomId: string;
    readonly status: string;
    readonly ttlExpired?: boolean;
    readonly callerCount?: number;
    readonly callerIds?: readonly string[];
    readonly deployScope?: 'dev-only' | 'all';
}
export interface LifecyclePoliceTransitionCheck {
    readonly atomId: string;
    readonly ok: boolean;
    readonly reason?: string;
}
export interface LifecyclePoliceRunOptions {
    readonly entries: readonly LifecyclePoliceInputEntry[];
    readonly transitions?: readonly LifecyclePoliceTransitionCheck[];
    readonly buildTarget?: 'production' | 'development';
    readonly actor?: string;
}
export declare function runLifecyclePolice(options: LifecyclePoliceRunOptions): LifecyclePoliceReport;
export declare const lifecyclePolicePlugin: {
    pluginId: string;
    run: typeof runLifecyclePolice;
};
export default lifecyclePolicePlugin;
