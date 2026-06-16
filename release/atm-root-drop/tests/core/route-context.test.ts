import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  emptyRouteResourceSet,
  isRouteContext,
  routeContextSchema,
  routeContextStates,
  validateRouteContext,
  type RouteContext
} from '../../packages/core/src/routing/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const jsonSchema = readJson('schemas/route-context.schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

assert.deepEqual(jsonSchema, routeContextSchema, 'published JSON schema and core routeContextSchema must stay in sync');
assert.equal(ajv.validateSchema(jsonSchema), true, formatErrors(ajv.errors));

const minimal = buildRouteContext();
assert.equal(isRouteContext(minimal), true);
assert.deepEqual(validateRouteContext(minimal), { ok: true, value: minimal });
assert.equal(ajv.compile(jsonSchema)(minimal), true);

const blocked = buildRouteContext({
  state: 'blocked',
  blockedBy: [
    {
      kind: 'lease',
      id: 'lease-other',
      reason: 'conflicting write lease is active'
    }
  ],
  admission: {
    verdict: 'blocked',
    reason: 'route cannot proceed while a conflicting write lease is active'
  }
});
assert.equal(isRouteContext(blocked), true);

const frozen = buildRouteContext({
  state: 'frozen',
  patchEnvelopeRef: 'patch-envelope://TASK-MAO-0002/route-001',
  admission: {
    verdict: 'freeze',
    reason: 'route is paused for steward review'
  }
});
assert.equal(isRouteContext(frozen), true);

const { lease: _missingLease, ...invalidMissingLease } = minimal;
const invalidResult = validateRouteContext(invalidMissingLease);
assert.equal(invalidResult.ok, false);
assert.match(invalidResult.ok ? '' : invalidResult.errors.join('\n'), /lease/);

assert.ok(routeContextStates.includes('ready-to-apply'));

console.log('[route-context:test] ok (minimal, blocked, frozen, invalid)');

function buildRouteContext(overrides: Partial<RouteContext> = {}): RouteContext {
  return {
    schemaId: 'atm.routeContext.v1',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Initial route context contract.'
    },
    routeId: 'route-TASK-MAO-0002-001',
    taskId: 'TASK-MAO-0002',
    actorId: 'captain',
    claimIntent: 'write',
    state: 'open',
    openedAt: '2026-06-14T11:23:26.274Z',
    lease: {
      leaseId: 'lease-route-context',
      issuedAt: '2026-06-14T11:23:26.274Z',
      heartbeatAt: '2026-06-14T11:23:26.274Z',
      ttlSeconds: 1800,
      maxSeconds: 7200
    },
    declaredReadSet: {
      ...emptyRouteResourceSet,
      files: ['docs/specs/mao-logical-routing-v1.md'],
      validators: ['npm run typecheck']
    },
    declaredWriteSet: {
      ...emptyRouteResourceSet,
      files: ['packages/core/src/routing/route-context.ts', 'schemas/route-context.schema.json'],
      validators: ['node --strip-types tests/core/route-context.test.ts']
    },
    targetAtomCids: ['cid:atm.mao-route-context-map'],
    targetVirtualAtomCids: [],
    patchEnvelopeRef: null,
    blockedBy: [],
    ...overrides
  };
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function formatErrors(errors: unknown) {
  return JSON.stringify(errors ?? [], null, 2);
}
