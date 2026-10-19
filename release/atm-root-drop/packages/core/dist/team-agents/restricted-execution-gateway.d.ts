import { type WorkAdmissionTicket } from '../broker/work-admission-ticket.js';
export declare const RESTRICTED_EXECUTION_RECEIPT_SCHEMA_ID = "atm.restrictedExecutionReceipt.v1";
/**
 * The ATM-only route sentence. Skills and structured CLI guidance project this
 * exact text so no surface invents its own wording, and so the wording itself
 * can never be read as an authorization.
 */
export declare const ATM_ONLY_EXECUTION_ROUTE_NOTICE = "Do not use native node -e, raw Git mutation, PowerShell write commands, or direct shell mutation as a worker route. Run the ATM command returned by the current playbook or diagnostic instead. This warning text never authorizes a command; only a RestrictedExecutionGateway allow decision does.";
/** Marker used by the skill compiler to prove the notice reached a template. */
export declare const ATM_ONLY_EXECUTION_ROUTE_MARKER = "ATM-Only Execution Route";
export type RestrictedExecutionClass = 
/** Team/external worker process launch. Nothing outside the allowlist runs. */
'external-worker-process'
/** Broker batch generated-write command manifest. */
 | 'command-manifest'
/** Declared read-only validator command. */
 | 'read-only-validator'
/** Supported editor pre-tool hook: guards dangerous shapes on a shared surface. */
 | 'editor-pre-tool';
export type RestrictedExecutionAdapterCapability = 'enforced' | 'unsupported';
export type RestrictedExecutionExecutableClass = 'atm-governed-command' | 'raw-git' | 'interpreter' | 'shell' | 'package-runner' | 'unclassified';
export type RestrictedExecutionRiskLevel = 'stage-only' | 'destructive' | 'governed-git-required' | 'interpreter-escape' | 'none';
export type RestrictedExecutionReasonCode = 'approved-atm-command' | 'allowlisted-read-only-command' | 'declared-generated-write-command' | 'guarded-surface-not-restricted' | 'raw-git-mutation' | 'interpreter-evaluation' | 'shell-command-escape' | 'executable-not-allowlisted' | 'validator-declares-writes' | 'missing-execution-authority' | 'undeclared-output' | 'external-write-capability-unsupported' | 'work-admission-ticket-missing' | 'work-admission-ticket-invalid';
export interface RestrictedExecutionRequest {
    readonly actor?: string | null;
    readonly taskId?: string | null;
    readonly laneSessionId?: string | null;
    readonly executionClass: RestrictedExecutionClass;
    readonly executable: string;
    readonly argv?: readonly string[];
    readonly cwd?: string | null;
    readonly declaredOutputs?: readonly string[];
    /**
     * Whether the calling adapter can actually stop the process before launch.
     * An adapter that cannot enforce pre-tool policy must pass `unsupported`;
     * it then never receives an external-write allow.
     */
    readonly adapterCapability?: RestrictedExecutionAdapterCapability;
    /** Claim-issued authority. Presence is mandatory on mutation-capable worker routes. */
    readonly workAdmissionTicket?: WorkAdmissionTicket | null;
    readonly claimGeneration?: string | null;
    readonly now?: string;
}
export interface RestrictedExecutionReceipt {
    readonly schemaId: typeof RESTRICTED_EXECUTION_RECEIPT_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly decision: 'allow' | 'deny';
    readonly reasonCode: RestrictedExecutionReasonCode;
    readonly executionClass: RestrictedExecutionClass;
    readonly executableClass: RestrictedExecutionExecutableClass;
    readonly normalizedExecutable: string;
    readonly normalizedArgvClass: readonly string[];
    readonly riskLevel: RestrictedExecutionRiskLevel;
    readonly actor: string | null;
    readonly taskId: string | null;
    readonly laneSessionId: string | null;
    readonly cwd: string | null;
    readonly declaredOutputs: readonly string[];
    readonly adapterCapability: RestrictedExecutionAdapterCapability;
    readonly workAdmissionTicketId: string | null;
    readonly workAdmissionDecisionCode: string | null;
    readonly approvedAtmCommand: string;
    readonly atmOnlyRouteNotice: typeof ATM_ONLY_EXECUTION_ROUTE_NOTICE;
    /** Text can never grant permission; recorded so audits can prove it. */
    readonly overridePolicy: {
        readonly promptTextAccepted: false;
        readonly environmentVariableAccepted: false;
    };
    readonly requestDigest: `sha256:${string}`;
    readonly evaluatedAt: string;
}
export interface RestrictedExecutionEvaluation {
    readonly decision: 'allow' | 'deny';
    readonly reasonCode: RestrictedExecutionReasonCode;
    readonly approvedAtmCommand: string;
    readonly receipt: RestrictedExecutionReceipt;
}
export declare function describeRestrictedExecutionAdapterCapability(adapterId: string | null | undefined): RestrictedExecutionAdapterCapability;
export declare function evaluateRestrictedExecution(request: RestrictedExecutionRequest): RestrictedExecutionEvaluation;
export declare const restrictedExecutionGateway: {
    readonly evaluate: typeof evaluateRestrictedExecution;
};
export interface RestrictedExecutionPolicyProjection {
    readonly schemaId: 'atm.restrictedExecutionGuidance.v1';
    readonly specVersion: '0.1.0';
    readonly notice: typeof ATM_ONLY_EXECUTION_ROUTE_NOTICE;
    readonly approvedRoute: string;
    readonly deniedExamples: readonly {
        readonly command: string;
        readonly reasonCode: RestrictedExecutionReasonCode;
        readonly approvedAtmCommand: string;
    }[];
    readonly overridePolicy: {
        readonly promptTextAccepted: false;
        readonly environmentVariableAccepted: false;
    };
}
/**
 * Read-only projection for skills, `next`, and hook recovery output. Callers
 * render these entries; they never maintain their own deny list. Each entry is
 * produced by actually running the sample through `evaluate`, so guidance text
 * cannot drift away from enforcement.
 */
export declare function describeRestrictedExecutionPolicy(now?: string): RestrictedExecutionPolicyProjection;
