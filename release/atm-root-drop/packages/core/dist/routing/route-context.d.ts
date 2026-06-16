export type RouteClaimIntent = 'read' | 'write' | 'review' | 'steward' | 'release-sync';
export type RouteContextState = 'open' | 'admitted' | 'frozen' | 'waiting' | 'blocked' | 'ready-to-apply' | 'closed' | 'abandoned';
export type RouteAdmissionVerdict = 'allow' | 'watch' | 'freeze' | 'serialize' | 'steward-required' | 'blocked';
export interface RouteContextMigration {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
}
export interface RouteResourceSet {
    readonly files: readonly string[];
    readonly atomCids: readonly string[];
    readonly virtualAtomCids: readonly string[];
    readonly validators: readonly string[];
    readonly artifacts: readonly string[];
}
export interface RouteLease {
    readonly leaseId: string;
    readonly issuedAt: string;
    readonly heartbeatAt: string;
    readonly ttlSeconds: number;
    readonly maxSeconds: number;
}
export interface RouteBlocker {
    readonly kind: 'route' | 'task' | 'lease' | 'atom-cid' | 'file' | 'validator' | 'steward';
    readonly id: string;
    readonly reason: string;
}
export interface RouteAdmission {
    readonly verdict: RouteAdmissionVerdict;
    readonly reason: string;
}
export interface RouteContext {
    readonly schemaId: 'atm.routeContext.v1';
    readonly specVersion: '0.1.0';
    readonly migration: RouteContextMigration;
    readonly routeId: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly claimIntent: RouteClaimIntent;
    readonly state: RouteContextState;
    readonly openedAt: string;
    readonly updatedAt?: string;
    readonly closedAt?: string;
    readonly lease: RouteLease;
    readonly declaredReadSet: RouteResourceSet;
    readonly declaredWriteSet: RouteResourceSet;
    readonly targetAtomCids: readonly string[];
    readonly targetVirtualAtomCids: readonly string[];
    readonly patchEnvelopeRef: string | null;
    readonly blockedBy: readonly RouteBlocker[];
    readonly admission?: RouteAdmission;
    readonly notes?: string;
}
export declare const routeContextStates: readonly ["open", "admitted", "frozen", "waiting", "blocked", "ready-to-apply", "closed", "abandoned"];
export declare const routeAdmissionVerdicts: readonly ["allow", "watch", "freeze", "serialize", "steward-required", "blocked"];
export declare const emptyRouteResourceSet: RouteResourceSet;
export declare const routeContextSchema: {
    readonly $schema: "https://json-schema.org/draft/2020-12/schema";
    readonly $id: "https://schemas.ai-atomic-framework.dev/route-context.schema.json";
    readonly title: "ATM Route Context v1";
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["schemaId", "specVersion", "migration", "routeId", "taskId", "actorId", "claimIntent", "state", "openedAt", "lease", "declaredReadSet", "declaredWriteSet", "targetAtomCids", "targetVirtualAtomCids", "patchEnvelopeRef", "blockedBy"];
    readonly properties: {
        readonly schemaId: {
            readonly const: "atm.routeContext.v1";
        };
        readonly specVersion: {
            readonly const: "0.1.0";
        };
        readonly migration: {
            readonly $ref: "#/$defs/migration";
        };
        readonly routeId: {
            readonly type: "string";
            readonly pattern: "^route-[A-Za-z0-9._:-]+$";
        };
        readonly taskId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly actorId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly claimIntent: {
            readonly enum: readonly ["read", "write", "review", "steward", "release-sync"];
        };
        readonly state: {
            readonly $ref: "#/$defs/state";
        };
        readonly openedAt: {
            readonly type: "string";
            readonly format: "date-time";
        };
        readonly updatedAt: {
            readonly type: "string";
            readonly format: "date-time";
        };
        readonly closedAt: {
            readonly type: "string";
            readonly format: "date-time";
        };
        readonly lease: {
            readonly $ref: "#/$defs/lease";
        };
        readonly declaredReadSet: {
            readonly $ref: "#/$defs/resourceSet";
        };
        readonly declaredWriteSet: {
            readonly $ref: "#/$defs/resourceSet";
        };
        readonly targetAtomCids: {
            readonly $ref: "#/$defs/stringList";
        };
        readonly targetVirtualAtomCids: {
            readonly $ref: "#/$defs/stringList";
        };
        readonly patchEnvelopeRef: {
            readonly type: readonly ["string", "null"];
            readonly minLength: 1;
        };
        readonly blockedBy: {
            readonly type: "array";
            readonly items: {
                readonly $ref: "#/$defs/blocker";
            };
        };
        readonly admission: {
            readonly $ref: "#/$defs/admission";
        };
        readonly notes: {
            readonly type: "string";
        };
    };
    readonly $defs: {
        readonly migration: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly required: readonly ["strategy", "fromVersion", "notes"];
            readonly properties: {
                readonly strategy: {
                    readonly enum: readonly ["none", "additive", "breaking"];
                };
                readonly fromVersion: {
                    readonly type: readonly ["string", "null"];
                    readonly pattern: "^\\d+\\.\\d+\\.\\d+$";
                };
                readonly notes: {
                    readonly type: "string";
                };
            };
        };
        readonly state: {
            readonly enum: readonly ["open", "admitted", "frozen", "waiting", "blocked", "ready-to-apply", "closed", "abandoned"];
        };
        readonly stringList: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
                readonly minLength: 1;
            };
            readonly uniqueItems: true;
        };
        readonly resourceSet: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly required: readonly ["files", "atomCids", "virtualAtomCids", "validators", "artifacts"];
            readonly properties: {
                readonly files: {
                    readonly $ref: "#/$defs/stringList";
                };
                readonly atomCids: {
                    readonly $ref: "#/$defs/stringList";
                };
                readonly virtualAtomCids: {
                    readonly $ref: "#/$defs/stringList";
                };
                readonly validators: {
                    readonly $ref: "#/$defs/stringList";
                };
                readonly artifacts: {
                    readonly $ref: "#/$defs/stringList";
                };
            };
        };
        readonly lease: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly required: readonly ["leaseId", "issuedAt", "heartbeatAt", "ttlSeconds", "maxSeconds"];
            readonly properties: {
                readonly leaseId: {
                    readonly type: "string";
                    readonly minLength: 1;
                };
                readonly issuedAt: {
                    readonly type: "string";
                    readonly format: "date-time";
                };
                readonly heartbeatAt: {
                    readonly type: "string";
                    readonly format: "date-time";
                };
                readonly ttlSeconds: {
                    readonly type: "integer";
                    readonly minimum: 1;
                };
                readonly maxSeconds: {
                    readonly type: "integer";
                    readonly minimum: 1;
                };
            };
        };
        readonly blocker: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly required: readonly ["kind", "id", "reason"];
            readonly properties: {
                readonly kind: {
                    readonly enum: readonly ["route", "task", "lease", "atom-cid", "file", "validator", "steward"];
                };
                readonly id: {
                    readonly type: "string";
                    readonly minLength: 1;
                };
                readonly reason: {
                    readonly type: "string";
                    readonly minLength: 1;
                };
            };
        };
        readonly admission: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly required: readonly ["verdict", "reason"];
            readonly properties: {
                readonly verdict: {
                    readonly enum: readonly ["allow", "watch", "freeze", "serialize", "steward-required", "blocked"];
                };
                readonly reason: {
                    readonly type: "string";
                    readonly minLength: 1;
                };
            };
        };
    };
};
export declare function isRouteContext(value: unknown): value is RouteContext;
export declare function validateRouteContext(value: unknown): {
    readonly ok: true;
    readonly value: RouteContext;
} | {
    readonly ok: false;
    readonly errors: readonly string[];
};
