import { createAtmAjv } from '../validation/ajv-factory.js';
export const routeContextStates = [
    'open',
    'admitted',
    'frozen',
    'waiting',
    'blocked',
    'ready-to-apply',
    'closed',
    'abandoned'
];
export const routeAdmissionVerdicts = [
    'allow',
    'watch',
    'freeze',
    'serialize',
    'steward-required',
    'blocked'
];
export const emptyRouteResourceSet = {
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
};
const validateRouteContextCompiled = createAtmAjv().compile(routeContextSchema);
export function isRouteContext(value) {
    return validateRouteContextCompiled(value);
}
export function validateRouteContext(value) {
    if (validateRouteContextCompiled(value)) {
        return { ok: true, value: value };
    }
    return {
        ok: false,
        errors: (validateRouteContextCompiled.errors ?? []).map((error) => {
            const location = error.instancePath || '/';
            return `${location} ${error.message ?? 'failed validation'}`;
        })
    };
}
