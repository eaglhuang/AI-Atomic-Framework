import { createAtmAjv } from '../validation/ajv-factory.ts';

export type RouteClaimIntent = 'read' | 'write' | 'review' | 'steward' | 'release-sync';

export type RouteContextState =
  | 'open'
  | 'admitted'
  | 'frozen'
  | 'waiting'
  | 'blocked'
  | 'ready-to-apply'
  | 'closed'
  | 'abandoned';

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

export const routeContextStates = [
  'open',
  'admitted',
  'frozen',
  'waiting',
  'blocked',
  'ready-to-apply',
  'closed',
  'abandoned'
] as const satisfies readonly RouteContextState[];

export const routeAdmissionVerdicts = [
  'allow',
  'watch',
  'freeze',
  'serialize',
  'steward-required',
  'blocked'
] as const satisfies readonly RouteAdmissionVerdict[];

export const emptyRouteResourceSet: RouteResourceSet = {
  files: [],
  atomCids: [],
  virtualAtomCids: [],
  validators: [],
  artifacts: []
};

export const routeContextSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.ai-atomic-framework.dev/route-context.schema.json',
  title: 'ATM Route Context v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaId',
    'specVersion',
    'migration',
    'routeId',
    'taskId',
    'actorId',
    'claimIntent',
    'state',
    'openedAt',
    'lease',
    'declaredReadSet',
    'declaredWriteSet',
    'targetAtomCids',
    'targetVirtualAtomCids',
    'patchEnvelopeRef',
    'blockedBy'
  ],
  properties: {
    schemaId: { const: 'atm.routeContext.v1' },
    specVersion: { const: '0.1.0' },
    migration: { $ref: '#/$defs/migration' },
    routeId: { type: 'string', pattern: '^route-[A-Za-z0-9._:-]+$' },
    taskId: { type: 'string', minLength: 1 },
    actorId: { type: 'string', minLength: 1 },
    claimIntent: { enum: ['read', 'write', 'review', 'steward', 'release-sync'] },
    state: { $ref: '#/$defs/state' },
    openedAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    closedAt: { type: 'string', format: 'date-time' },
    lease: { $ref: '#/$defs/lease' },
    declaredReadSet: { $ref: '#/$defs/resourceSet' },
    declaredWriteSet: { $ref: '#/$defs/resourceSet' },
    targetAtomCids: { $ref: '#/$defs/stringList' },
    targetVirtualAtomCids: { $ref: '#/$defs/stringList' },
    patchEnvelopeRef: { type: ['string', 'null'], minLength: 1 },
    blockedBy: { type: 'array', items: { $ref: '#/$defs/blocker' } },
    admission: { $ref: '#/$defs/admission' },
    notes: { type: 'string' }
  },
  $defs: {
    migration: {
      type: 'object',
      additionalProperties: false,
      required: ['strategy', 'fromVersion', 'notes'],
      properties: {
        strategy: { enum: ['none', 'additive', 'breaking'] },
        fromVersion: { type: ['string', 'null'], pattern: '^\\d+\\.\\d+\\.\\d+$' },
        notes: { type: 'string' }
      }
    },
    state: { enum: routeContextStates },
    stringList: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      uniqueItems: true
    },
    resourceSet: {
      type: 'object',
      additionalProperties: false,
      required: ['files', 'atomCids', 'virtualAtomCids', 'validators', 'artifacts'],
      properties: {
        files: { $ref: '#/$defs/stringList' },
        atomCids: { $ref: '#/$defs/stringList' },
        virtualAtomCids: { $ref: '#/$defs/stringList' },
        validators: { $ref: '#/$defs/stringList' },
        artifacts: { $ref: '#/$defs/stringList' }
      }
    },
    lease: {
      type: 'object',
      additionalProperties: false,
      required: ['leaseId', 'issuedAt', 'heartbeatAt', 'ttlSeconds', 'maxSeconds'],
      properties: {
        leaseId: { type: 'string', minLength: 1 },
        issuedAt: { type: 'string', format: 'date-time' },
        heartbeatAt: { type: 'string', format: 'date-time' },
        ttlSeconds: { type: 'integer', minimum: 1 },
        maxSeconds: { type: 'integer', minimum: 1 }
      }
    },
    blocker: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'id', 'reason'],
      properties: {
        kind: { enum: ['route', 'task', 'lease', 'atom-cid', 'file', 'validator', 'steward'] },
        id: { type: 'string', minLength: 1 },
        reason: { type: 'string', minLength: 1 }
      }
    },
    admission: {
      type: 'object',
      additionalProperties: false,
      required: ['verdict', 'reason'],
      properties: {
        verdict: { enum: routeAdmissionVerdicts },
        reason: { type: 'string', minLength: 1 }
      }
    }
  }
} as const;

const validateRouteContextCompiled = createAtmAjv().compile(routeContextSchema);

export function isRouteContext(value: unknown): value is RouteContext {
  return validateRouteContextCompiled(value) as boolean;
}

export function validateRouteContext(value: unknown): { readonly ok: true; readonly value: RouteContext } | { readonly ok: false; readonly errors: readonly string[] } {
  if (validateRouteContextCompiled(value)) {
    return { ok: true, value: value as RouteContext };
  }

  return {
    ok: false,
    errors: (validateRouteContextCompiled.errors ?? []).map((error) => {
      const location = error.instancePath || '/';
      return `${location} ${error.message ?? 'failed validation'}`;
    })
  };
}
